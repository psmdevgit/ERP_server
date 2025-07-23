const jsforce = require('jsforce');

const conn = new jsforce.Connection({
  loginUrl: process.env.SALESFORCE_LOGIN_URL,
});

async function salesforceLogin() {
  try {
    await conn.login(process.env.SALESFORCE_USERNAME, process.env.SALESFORCE_PASSWORD);
    console.log('Connected to Salesforce');
  } catch (error) {
    console.error('Salesforce login error:', error);
    throw error;
  }
}

module.exports = { conn, salesforceLogin };
