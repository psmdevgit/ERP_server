const bcrypt = require('bcrypt');
const jsforce = require('jsforce');
require('dotenv').config();

const conn = new jsforce.Connection({
  loginUrl: process.env.SALESFORCE_LOGIN_URL,
});

async function createUser(username, password, email) {
  const hashedPassword = await bcrypt.hash(password, 10); // Hash the password

  // Save to Salesforce
  const result = await conn.sobject('CustomUser__c').create({
    Username__c: username,
    Password__c: hashedPassword, // Store the hashed password
    Email__c: email,
    Status__c: 'Active',
  });

  console.log('User created:', result);
  return result;
}

module.exports = { createUser };
