const {AutotaskRestApi} = require('@apigrate/autotask-restapi');
const CosmosClient = require("@azure/cosmos").CosmosClient;
const { v4: uuidv4 } = require('uuid');
const fetch = require("node-fetch-commonjs");

module.exports = async function (context, req) {
    const params = new URLSearchParams(req.body);
    context.log('JavaScript HTTP trigger function processed a request.');

    const name = (params && params.get('Name'));
    const method = (params && params.get('Method'));
    const testID = (params && params.get('TestID'));
    const status = (params && params.get('Status'));
    const statusCode = (params && params.get('StatusCode'));
    const url = (params && params.get('URL'));
    const ip = (params && params.get('IP'));
    var tags = (params && params.get('Tags') && params.get('Tags').split(','));

    if (!tags) {
        tags = [];
    }
    
    context.log(`Name: ${name}, Method: ${method}, TestID: ${testID}, Url: ${url}, IP: ${ip}, Status: ${status}, Tags: ${tags}`);

    const responseMessage = name
        ? "Test: '" + name + "' was triggered. Status: " + status + "(" + statusCode + ")" +
            " \n URL: " + url + " IP: " + ip + "\n Tags: " + tags +
            " \n Method: " + method + " TestID: " + testID
        : "This HTTP triggered function executed successfully.";

    if (method != "Website") {
        context.log.warn("Method is not a website uptime. Exiting...");
        context.res = {
            status: 400,
            body: "Method is not a website uptime. Exiting..."
        };
        context.done();
        return;
    }


    // Connect to the Autotask API
    const autotask = new AutotaskRestApi(
        process.env.AUTOTASK_USER,
        process.env.AUTOTASK_SECRET, 
        process.env.AUTOTASK_INTEGRATION_CODE 
    );
    let api = await autotask.api();

    // Connect to DB
    const dbClient = new CosmosClient({ 
        endpoint: process.env.DB_ENDPOINT, 
        key : process.env.DB_KEY
    });
    const database = dbClient.database(process.env.DB_DATABASE);
    const ticketReferenceContainer = database.container("TicketReference");

    // Verify the Autotask API key works (the library doesn't always provide a nice error message)
    var useAutotaskAPI = true;
    try {
        let fetchParms = {
            method: 'GET',
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Apigrate/1.0 autotask-restapi NodeJS connector"
            }
        };
        fetchParms.headers.ApiIntegrationcode = process.env.AUTOTASK_INTEGRATION_CODE;
        fetchParms.headers.UserName =  process.env.AUTOTASK_USER;
        fetchParms.headers.Secret = process.env.AUTOTASK_SECRET;

        let test_url = `${autotask.zoneInfo ? autotask.zoneInfo.url : autotask.base_url}V${autotask.version}/Companies/entityInformation`;
        let response = await fetch(`${test_url}`, fetchParms);
        if(!response.ok){
            var result = await response.text();
            if (!result) {
                result = `${response.status} - ${response.statusText}`;
            }
            throw result;
        }
    } catch (error) {
        if (error.startsWith("401")) {
            error = `API Key Unauthorized. (${error})`
        }
        context.log.error(error);
        useAutotaskAPI = false;
    }


    if (status == "Down") {
        // If this alert is an uptime test going Down:
        // Determine the client and device (if applicable)
        // Create a new ticket
        // Add details to ticket notes
        // Store the ticket info in database for reference when the Up status alert comes in
        
        // Find company
        let autotaskCompanies;

        if (useAutotaskAPI) {
            var companyIDTags = tags.filter(tag => tag.includes('CompanyID:'));
            if (companyIDTags && companyIDTags.length > 0) {
                var companyID = companyIDTags[0].replace("CompanyID:", "").trim();
                autotaskCompanies = await api.Companies.query({
                    filter: [
                        {
                            "op": "eq",
                            "field": "id",
                            "value": companyID
                        }
                    ],
                    includeFields: [
                        "id", "companyName", "companyNumber", "isActive"
                    ]
                });
            }

            var companyTags = tags.filter(tag => tag.includes('Company:'));
            if (companyTags && companyTags.length > 0) {
                var companyName = companyTags[0].replace("Company:", "");
            } else {
                var companyName;
                if (name.indexOf('-') == -1) {
                    if (name.indexOf(' ') == -1) {
                        companyName = name;
                    } else {
                        companyName = name.substring(0, name.indexOf(' '));
                    }
                } else {
                    companyName = name.substring(0, name.indexOf('-'));
                }
            }
            companyName = companyName.trim();

            if (companyName && (!autotaskCompanies || autotaskCompanies.items.length == 0)) {
                autotaskCompanies = await api.Companies.query({
                    filter: [
                        {
                            "op": "or",
                            "items": [
                                {
                                    "op": "eq",
                                    "field": "CompanyNumber",
                                    "value": companyName
                                },
                                {
                                    "op": "eq",
                                    "field": "Client Abbreviation",
                                    "value": companyName,
                                    "udf": true
                                }
                            ]
                        }
                    ],
                    includeFields: [
                        "id", "companyName", "companyNumber", "isActive"
                    ]
                }); 

                if (!autotaskCompanies || autotaskCompanies.items.length < 1) {
                    autotaskCompanies = await api.Companies.query({
                        filter: [
                            {
                                "op": "contains",
                                "field": "CompanyName",
                                "value": companyName
                            }
                        ],
                        includeFields: [
                            "id", "companyName", "companyNumber", "isActive"
                        ]
                    }); 
                }
            }

            // Filter down if multiple companies found and remove any inactive
            if (autotaskCompanies && autotaskCompanies.items.length > 0) {

                autotaskCompanies = autotaskCompanies.items.filter(company => {
                    return company.isActive == true;
                });

                if (autotaskCompanies.length > 1) {
                    autotaskCompanies = autotaskCompanies.filter(company => {
                        return (name.toLowerCase()).search(company.companyName.toLowerCase()) > -1;
                    });
                    if (autotaskCompanies.length > 1) {
                        autotaskCompanies = [];
                    }
                }
            }
        }

        // If no company found, default to 0 as the default
        if (!autotaskCompanies || autotaskCompanies.length !== 1) {
            autotaskCompanies = [
                {
                    id: 0,
                    isActive: true,
                    companyName: "",
                    companyNumber: ""   
                }
            ];
        }

        // Get primary location and default contract
        var contractID = null;
        var location = null;
        if (useAutotaskAPI && autotaskCompanies && autotaskCompanies.length == 1) {
            let locations = await api.CompanyLocations.query({
                filter: [
                    {
                        "op": "eq",
                        "field": "CompanyID",
                        "value": autotaskCompanies[0].id
                    }
                ],
                includeFields: [
                    "id", "isActive", "isPrimary"
                ]
            });

            locations = locations.items.filter(location => location.isActive);

            var location;
            if (locations.length > 0) {
                location = locations.filter(location => location.isPrimary);
                location = location[0];
                if (!location) {
                    location = locations[0];
                }
            } else {
                location = locations[0];
            }

            let contract = await api.Contracts.query({
                filter: [
                    {
                        "op": "and",
                        "items": [
                            {
                                "op": "eq",
                                "field": "CompanyID",
                                "value": autotaskCompanies[0].id
                            },
                            {
                                "op": "eq",
                                "field": "IsDefaultContract",
                                "value": true
                            }
                        ]
                    }
                ],
                includeFields: [ "id" ]
            });
            
            if (contract.items && contract.items.length > 0) {
                contractID = contract.items[0].id
            }
        }

        // Get device
        var configurationItemID = null;
        if (useAutotaskAPI && deviceTags && deviceTags.length > 0) {
            var deviceTags = tags.filter(tag => tag.includes('Device:'));
            var deviceName = deviceTags[0].replace("Device:", "").trim();
            let autotaskDevices = await api.ConfigurationItems.query({
                filter: [
                    {
                        "op": "and",
                        "items": [
                            {
                                "op": "eq",
                                "field": "CompanyID",
                                "value": autotaskCompanies[0].id
                            },
                            {
                                "op": "or",
                                "items": [
                                    {
                                        "op": "contains",
                                        "field": "ReferenceTitle",
                                        "value": deviceName
                                    },
                                    {
                                        "op": "contains",
                                        "field": "rmmDeviceAuditHostname",
                                        "value": deviceName
                                    }
                                ]
                            }
                        ]
                    }
                ],
                includeFields: [
                    "id", "companyID", "isActive", "referenceTitle",
                    "rmmDeviceAuditExternalIPAddress"
                ]
            });

            if (autotaskDevices && autotaskDevices.items.length > 0) {
                autotaskDevices = autotaskDevices.items.filter(device => device.isActive);

                if (autotaskDevices.length > 1 && device.rmmDeviceAuditExternalIPAddress) {
                    var autotaskDevicesFiltered = autotaskDevices.filter(device => {
                        return device.rmmDeviceAuditExternalIPAddress.trim() == url ||
                            device.rmmDeviceAuditExternalIPAddress.trim() == ip
                    })

                    if (autotaskDevicesFiltered.length > 0) {
                        autotaskDevices = autotaskDevicesFiltered;
                    }
                }

                if (autotaskDevices.length > 0) {
                    autotaskDevices = autotaskDevices[0];
                    configurationItemID = autotaskDevices.id;
                }
            }
        }

        // Connect to statuscake API and get details
        let uptimeTestDetails;
        try {
            let scReponse = await fetch('https://api.statuscake.com/v1/uptime/' + testID, {
                headers: {
                    Authorization: `Bearer ${process.env.STATUSCAKE_API_KEY}`
                }
            });
            uptimeTestDetails = await scReponse.json();
        } catch (error) {
            context.log.error(error);
        }

        let uptimeAlerts;
        try {
            let scReponse = await fetch('https://api.statuscake.com/v1/uptime/' + testID + '/alerts', {
                headers: {
                    Authorization: `Bearer ${process.env.STATUSCAKE_API_KEY}`
                }
            });
            uptimeAlerts = await scReponse.json();
        } catch (error) {
            context.log.error(error);
        }
        
        var detailedNotes = "";
        if (uptimeTestDetails && uptimeTestDetails.data) {
            detailedNotes = 'Additional Details \n';
            detailedNotes += '-----------------------\n';
            detailedNotes += `Today's Uptime: ${uptimeTestDetails.data.uptime}% \n`;
        }

        if (uptimeAlerts && uptimeAlerts.data) {
            let twoWeeksAgo = new Date();
            twoWeeksAgo.setDate((new Date()).getDate() - 14);

            var downAlerts = uptimeAlerts.data
                .filter(alert => alert.status == 'down')
                .map(alert => {
                    alert.triggered_at_date = new Date(alert.triggered_at.replace("+00:00", ""));
                    return alert;
                })
            var recentDownAlerts = downAlerts.filter(alert => Date.parse(alert.triggered_at_date) > Date.parse(twoWeeksAgo));

            if (downAlerts[1]) {
                var downtime = downAlerts[1].triggered_at_date;
                detailedNotes += `Last Downtime: ${downtime.toDateString()} ${downtime.toLocaleTimeString()} \n`;
            }

            if (recentDownAlerts && recentDownAlerts.length > 0) {
                detailedNotes += `Total Down Alerts (past 2 weeks): ${recentDownAlerts.length}`;
            }
        }

        // Make a new ticket
        var title = `Your Site: ${name} Is Currently Down`;
        var ipOrUrl = (ip ? ip : url);
        var ipOrUrlType = (/[a-zA-Z]/.test(ipOrUrl) ? "Url" : "IP");
        var description = `Alert from StatusCake. \n${name} Has Gone Down. \n${ipOrUrlType} test: ${ipOrUrl} \nStatus Code: ${statusCode} \n\n\n${detailedNotes}`;
        let newTicket = {
            CompanyID: (autotaskCompanies ? autotaskCompanies[0].id : 0),
            CompanyLocationID: (location ? location.id : 10),
            Priority: 1,
            Status: 1,
            QueueID: parseInt(process.env.TICKET_QueueID),
            IssueType: parseInt(process.env.TICKET_IssueType),
            SubIssueType: parseInt(process.env.TICKET_SubIssueType),
            ServiceLevelAgreementID: parseInt(process.env.TICKET_ServiceLevelAgreementID),
            ContractID: (contractID ? contractID : null),
            ConfigurationItemID: configurationItemID,
            Title: title,
            Description: description
        };

        var ticketID = null;
        try {
            result = await api.Tickets.create(newTicket);
            ticketID = result.itemId;
            if (!ticketID) {
                throw "No ticket ID";
            } else {
                context.log("New ticket created: " + ticketID);
            }
        } catch (error) {
            // Send an email to support if we couldn't create the ticket
            var mailBody = {
                From: {
                    Email: process.env.EMAIL_FROM__Email,
                    Name: process.env.EMAIL_FROM__Name
                },
                To: [
                    {
                        Email: process.env.EMAIL_TO__Email,
                        Name: process.env.EMAIL_TO__Name
                    }
                ],
                "Subject": title,
                "HTMLContent": description.replace(new RegExp('\r?\n','g'), "<br />")
            }

            try {
                let emailResponse = await fetch(process.env.EMAIL_API_ENDPOINT, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.EMAIL_API_KEY
                    },
                    method: "POST",
                    body: JSON.stringify(mailBody)
                });
                context.log.warn("Ticket creation failed. Backup email sent to support.");
            } catch (error) {
                context.log.error("Ticket creation failed. Sending an email as a backup also failed.");
                context.log.error(error);
            }
            ticketID = null;
        }

        // Store reference info in the DB
        if (ticketID) {
            let dbTicket = {
                id: uuidv4(),
                testid: testID,
                testName: name,
                url: url,
                ip: ip,
                ticketid: ticketID
            };
            const { resource: createdItem } = await ticketReferenceContainer.items.create(dbTicket);
        }
        
    } else if (status == "Up") {
        // If this alert is an uptime test going Up:
        // Find the previous ticket in the database,
        // Update the ticket notes, 
        // Close the old ticket
        // Remove DB reference from "Down" ticket

        let dbTickets = await ticketReferenceContainer.items
            .query({
                query: "SELECT * FROM c WHERE c.testid = @testID",
                parameters: [{ name: "@testID", value: testID }]
            })
            .fetchAll();

        if (useAutotaskAPI && dbTickets && dbTickets.resources && dbTickets.resources.length > 0) {
            for (var dbTicket of dbTickets.resources) {
                let downTickets = await api.Tickets.query({
                    filter: [
                        {
                            "op": "eq",
                            "field": "id",
                            "value": dbTicket.ticketid
                        }
                    ],
                    includeFields: [
                        "id", "companyID", "companyLocationID", "createDate",
                        "status", "ticketNumber", "title", "configurationItemID", "assignedResourceID"
                    ]
                });
                
                if (downTickets && downTickets.items.length > 0) {
                    var now = new Date();
                    var downDate = new Date(dbTicket._ts * 1000);
                    var downtimeDiff = Math.abs(now.getTime() - downDate.getTime()) / 1000;

                    var downDays = Math.floor(downtimeDiff / 86400);
                    downtimeDiff -= downDays * 86400;
                    var downHours = Math.floor(downtimeDiff / 3600) % 24;
                    downtimeDiff -= downHours * 3600;
                    var downMinutes = Math.floor(downtimeDiff / 60) % 60;
                    downtimeDiff -= downMinutes * 60;
                    var downSeconds = Math.floor(downtimeDiff % 60);

                    var downtimeStr = downHours.toString().padStart(2, 0) + ':' + downMinutes.toString().padStart(2, 0) + ':' + downSeconds.toString().padStart(2, 0);
                    if (downDays) {
                        downtimeStr = downDays + " days, " + downtimeStr;
                    }

                    for (var downTicket of downTickets.items) {
                        if (downTicket.status != 5) {
                            // Down ticket is still open, update it
                            let closingNote = {
                                "TicketID": downTicket.id,
                                "Title": "Self-Healing Update",
                                "Description": "[Self-Healing] The device is now back up. This ticket has been auto-closed. Total downtime: " + downtimeStr,
                                "NoteType": 1,
	                            "Publish": 1
                            }
                            api.TicketNotes.create(downTicket.id, closingNote);
                            
                            let closingTicket = {
                                "id": downTicket.id,
                                "Status": (downTicket.assignedResourceID ? 13 : 5)
                            }
                            api.Tickets.update(closingTicket);
                        }
                    }
                }

                await ticketReferenceContainer.item(dbTicket.id, testID).delete();
            }

            context.log("Ticket closed!");
            context.log(dbTickets);
        } else {
            context.log.warn("No ticket found to close.");
        }

    } else {
        // No ticket found
        context.log.warn("No status.");
    }

    context.res = {
        // status: 200, /* Defaults to 200 */
        body: responseMessage
    };
}