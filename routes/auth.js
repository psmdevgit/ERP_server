const express = require('express');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

// Register a new user
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.create(username, password);
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error) {
    if (error.code === 'DUPLICATE_VALUE') {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Login a user
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findByUsername(username);

    if (!user || !(await bcrypt.compare(password, user.Password__c))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate a JWT token
    const token = jwt.sign({ id: user.Id, username: user.Username__c }, JWT_SECRET, {
      expiresIn: '1h',
    });

    res.json({ message: 'Login successful', token });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
