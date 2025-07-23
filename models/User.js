const { conn } = require('../config/salesforce');
const bcrypt = require('bcryptjs');

class User {
  static async create(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      Username__c: username,
      Password__c: hashedPassword,
    };

    try {
      const result = await conn.sobject('CustomUser__c').create(newUser);
      return result;
    } catch (error) {
      throw error;
    }
  }

  static async findByUsername(username) {
    try {
      const query = `SELECT Id, Username__c, Password__c FROM CustomUser__c WHERE Username__c = '${username}' LIMIT 1`;
      const result = await conn.query(query);
      return result.records[0] || null;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = User;
