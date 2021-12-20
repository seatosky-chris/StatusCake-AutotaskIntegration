
# StatusCake - Autotask Integration

This script can be used to watch for StatusCake alerts and handle ticket creation and auto-closing in Autotask. The script is designed to be ran in an Azure function. You then grab the URL of the Azure function and plug that into the Webhook field of a Contact Group in StatusCake. Next, assign this contract group to any status monitors that you want the integration to manage. When an alert comes up, the script will create a new ticket in Autotask via the API. If the alert gets closed (because the device is back up), it will auto-close the ticket and add notes on downtime. If the ticket is assign to a technician it will place it in Plan Complete, if unassigned, it will fully Complete it. If the script cannot connect to the Autotask API, it will fallback to sending an email to an address of your choice.

### Configuration:
- Setup an Autotask API account with access to READ Companies, Locations, Contracts & ConfigurationItems, and to READ/WRITE Tickets and TicketNotes. Fill in the Autotask configuration with API account details in local.settings.json.
- Create a new DB in CosmosDB in Azure. Fill in the DB configuration with the database details in local.settings.json.
- Create a StatusCake API key and fill in the STATUSCAKE_API_KEY value in local.settings.json.
- Configure the Email forwarder details in local.settings.json. (See my Email Forwarder script.) This could also be configured to use something like SendGrid instead but the script may require minor modifications.
- Push this to an Azure Function and ensure the environment variables get updated.
- Get the URL of the Azure Function and create a new contact group in StatusCake, paste the function's URL in the Webhook field.
- Assign this contact group to any status monitors you want the integration to manage.