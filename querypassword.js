const jsforce = require('jsforce');
require('dotenv').config();

const conn = new jsforce.Connection({
  loginUrl: process.env.SALESFORCE_LOGIN_URL,
});

async function queryPassword(username) {
  try {
    // Log in to Salesforce
    await conn.login(process.env.SALESFORCE_USERNAME, process.env.SALESFORCE_PASSWORD);

    // Query the password for the given username
    const query = `SELECT Id, Username__c, Password__c FROM CustomUser__c WHERE Username__c = '${username}' LIMIT 1`;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      console.log(`User '${username}' not found.`);
      return;
    }

    const user = result.records[0];
    console.log(`User ID: ${user.Id}`);
    console.log(`Username: ${user.Username__c}`);
    console.log(`Hashed Password: ${user.Password__c}`);
  } catch (error) {
    console.error('Error querying password:', error);
  }
}

// Call the function with the username 'john_doe'
queryPassword('john_doe');
