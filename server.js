const bcrypt = require("bcrypt");
const express = require("express");
const jsforce = require("jsforce");
const multer = require("multer");
require("dotenv").config();
const { addJewelryModel } = require("./addjewlery");
const chrome = require('@puppeteer/browsers');
const {submitOrder} = require("./submitOrder");
const app = express();
const storage = multer.memoryStorage();
const upload = multer({
  limits: {
    fieldSize: 10 * 1024 * 1024, // 10MB limit for field values
    fileSize: 10 * 1024 * 1024   // 10MB limit for files
  }
});
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const axios = require('axios'); // Import axios
var bodyParser = require('body-parser');



// Also increase Express limit
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ 
  limit: '500mb',
  extended: true,
  parameterLimit: 50000 
}));

const cors = require('cors');

const allowedOrigins = [
  "app://-",
  "app://.",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.5.62:3000",
  "https://psmgoldcrafts-com.vercel.app",
  "https://erp-server-r9wh.onrender.com"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Origin",
    "X-Requested-With",
    "Accept"
  ],
  exposedHeaders: ["set-cookie"]
}));

// Proper preflight handling with same config
app.options('*', cors({
  origin: allowedOrigins,
  credentials: true
}));

// JSON middleware
app.use(express.json());

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});



// Salesforce Connection
let conn;
let isConnected = false;

app.get('/api/test', (req, res) => {
  res.send('API is working behind IIS with iisnode!');
});

app.listen(3001, '0.0.0.0', () => {
  console.log('Server running on port 3001');
});

// Configure body-parser with increased limits
app.use(bodyParser.json({ limit: '500mb' }));  // Increase as needed
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));

// Initialize Salesforce Connection
async function initializeSalesforceConnection() {
  try {
    conn = new jsforce.Connection({
      loginUrl: process.env.SALESFORCE_LOGIN_URL,
    });
    await conn.login(process.env.SALESFORCE_USERNAME, process.env.SALESFORCE_PASSWORD);
    isConnected = true;
    console.log("Connected to Salesforce");
  } catch (error) {
    console.error("Failed to connect to Salesforce:", error.message || error);
    process.exit(1);
  }
}
initializeSalesforceConnection();

// Middleware to check Salesforce connection
function checkSalesforceConnection(req, res, next) {
  if (!isConnected) {
    return res.status(500).json({ success: false, error: "Salesforce connection not established." });
  }
  next();
}

/** ----------------- User Authentication ------------------ **/

// Login Endpoint
app.post("/login", checkSalesforceConnection, async (req, res) => {
  try {
    console.log('Login attempt from origin:', req.headers.origin);
    console.log('Request headers:', req.headers);
    
    const { username, password } = req.body;

    if (!username || !password) {
      console.log('Missing credentials');
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required." 
      });
    }

    console.log('Querying user:', username);
    const query = `
      SELECT Id, Username__c, Password__c, Status__c
      FROM CustomUser__c
      WHERE Username__c = '${username}' LIMIT 1
    `;
    
    const result = await conn.query(query);
    console.log('Query result length:', result.records.length);

    if (result.records.length === 0) {
      console.log('User not found:', username);
      return res.status(404).json({ 
        success: false, 
        error: "User not found." 
      });
    }

    const user = result.records[0];
    if (user.Status__c !== "Active") {
      console.log('Inactive user attempt:', username);
      return res.status(403).json({ 
        success: false, 
        error: "User is inactive." 
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.Password__c);
    console.log('Password validation result:', isPasswordValid);
    
    if (!isPasswordValid) {
      console.log('Invalid password for user:', username);
      return res.status(401).json({ 
        success: false, 
        error: "Invalid password." 
      });
    }

    console.log('Successful login for user:', username);
    res.json({ 
      success: true, 
      message: "Login successful", 
      userId: user.Id 
    });
    
  } catch (error) {
    console.error("Login error:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({ 
      success: false, 
      error: "Internal server error.",
      
      details: error.message 
    });
  }
});

/** ----------------- Item Groups Management ------------------ **/
app.get("/OrderIDNumber", checkSalesforceConnection, async (req, res) => { 
  try {
    const query = `
      SELECT Id, Order_Id__c 
      FROM Order__c
      ORDER BY Order_Id__c
    `;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      return res.status(404).json({ success: false, message: "No orders found." });
    }

    res.json({ success: true, data: result.records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Create Item Group
app.post("/add-item-group", checkSalesforceConnection, async (req, res) => {
  try {
    const { itemGroupName } = req.body;

    if (!itemGroupName) {
      return res.status(400).json({ success: false, error: "Item group name is required." });
    }

    const result = await conn.sobject("ItemGroup__c").create({ ItemGroupName__c: itemGroupName });
    if (result.success) {
      res.json({ success: true, message: "Item group created.", id: result.id });
    } else {
      res.status(500).json({ success: false, error: "Failed to create item group.", details: result.errors });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch Item Groups
app.get("/item-groups", checkSalesforceConnection, async (req, res) => {
  try {
    const query = `
      SELECT Id, ItemGroupName__c
      FROM ItemGroup__c
      ORDER BY ItemGroupName__c
    `;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      return res.status(404).json({ success: false, message: "No item groups found." });
    }

    res.json({ success: true, data: result.records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** ----------------- Product Groups Management ------------------ **/

// Create Product Group
app.post("/add-product-group", checkSalesforceConnection, async (req, res) => {
  try {
    const { productGroupName } = req.body;

    if (!productGroupName) {
      return res.status(400).json({ success: false, error: "Product group name is required." });
    }

    const result = await conn.sobject("Product_Group__c").create({
      Name: productGroupName, // Assign productGroupName to the Name field
      ProductGroupName__c: productGroupName, // Assign productGroupName to the custom field
    });;
    if (result.success) {
      res.json({ success: true, message: "Product group created.", id: result.id });
    } else {
      res.status(500).json({ success: false, error: "Failed to create product group.", details: result.errors });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch Product Groups
app.get("/product-groups", checkSalesforceConnection, async (req, res) => {
  try {
    const query = `
      SELECT Id, ProductGroupName__c
      FROM Product_Group__c
      ORDER BY ProductGroupName__c
    `;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      return res.status(404).json({ success: false, message: "No product groups found." });
    }

    res.json({ success: true, data: result.records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** ----------------- Size Groups Management ------------------ **/

// Create Size Group
app.post("/add-size-group", checkSalesforceConnection, async (req, res) => {
  try {
    const { sizeGroupName } = req.body;

    if (!sizeGroupName) {
      return res.status(400).json({ success: false, error: "Size group name is required." });
    }

    const result = await conn.sobject("jewlerysize__c").create({ Size__c: sizeGroupName });
    if (result.success) {
      res.json({ success: true, message: "Size group created.", id: result.id });
    } else {
      res.status(500).json({ success: false, error: "Failed to create size group.", details: result.errors });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch Size Groups
app.get("/size-groups", checkSalesforceConnection, async (req, res) => {
  try {
    const query = `
      SELECT Id, Size__c
      FROM jewlerySize__c
      ORDER BY Size__c
    `;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      return res.status(404).json({ success: false, message: "No size groups found." });
    }

    res.json({ success: true, data: result.records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** ----------------- Jewelry Category Management ------------------ **/


app.post("/add-jewelry-category", checkSalesforceConnection, async (req, res) => {
    try {
      const {
        itemGroup = null,
        categoryName = null,
        categoryCode = null,
        productGroup = null,
        rate = null,
        hsn = null,
        maxOrderQty = null,
        size = null,
        color = null,
      } = req.body;
  
      // Validate mandatory fields (adjust based on your requirements)
      if (!categoryName || !categoryCode) {
        return res.status(400).json({
          success: false,
          error: "Category Name and Category Code are required fields.",
        });
      }
  
      // Create new JewelryCategory__c record
      const result = await conn.sobject("Jewelry_Category__c").create({
        ItemGroup__c: itemGroup,
        Name: categoryName,
        Category_Code__c: categoryCode,
        Product_Group__c: productGroup,
        Rate__c: rate,
        HSN__c: hsn,
        Max_Order_Qty__c: maxOrderQty,
        Size__c: size,
        Color__c: color,
      });
  
      if (result.success) {
        res.status(200).json({
          success: true,
          message: "Jewelry category added successfully",
          id: result.id,
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to create jewelry category",
          details: result.errors,
        });
      }
    } catch (error) {
      console.error("Error adding jewelry category:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  app.get("/Category-groups", checkSalesforceConnection, async (req, res) => {
    try {
      const query = `
        SELECT Name
        FROM Jewelry_Category__c
        ORDER BY Name
      `;
      const result = await conn.query(query);
  
      if (result.records.length === 0) {
        return res.status(404).json({ success: false, message: "No Category groups found." });
      }
  
      res.json({ success: true, data: result.records });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

/** ----------------- Jewelry Model Management ------------------ **/

// Add Jewelry Model
app.post("/api/add-jewelry", upload.single("item-image"), async (req, res) => {
  try {
    console.log("Received a request to add a jewelry model");

    // Parse the request body
    let jewelryModelData, stoneDetailsData;
    try {
      jewelryModelData = JSON.parse(req.body.jewelryModel); // Parse jewelry model data
      stoneDetailsData = JSON.parse(req.body.stoneDetails); // Parse stone details data
      console.log("Parsed request body successfully:", { jewelryModelData, stoneDetailsData });
    } catch (parseError) {
      console.error("Error parsing request body:", parseError.message);
      return res.status(400).json({
        success: false,
        message: "Invalid request body. Failed to parse JSON.",
        error: parseError.message,
      });
    }

    // Validate the jewelry model data
    if (!jewelryModelData || Object.keys(jewelryModelData).length === 0) {
      console.error("Jewelry model data is missing or empty.");
      return res.status(400).json({
        success: false,
        message: "Jewelry model data is required.",
      });
    }

    console.log("Adding jewelry model:", jewelryModelData);

    // Add jewelry model to Salesforce with attachment
    const jewelryModelResult = await addJewelryModel(conn, jewelryModelData, req.file);

    if (!jewelryModelResult.success) {
      console.error("Failed to create Jewelry Model:", jewelryModelResult);
      return res.status(500).json({
        success: false,
        message: "Failed to create Jewelry Model",
        details: jewelryModelResult,
      });
    }

    const jewelryModelId = jewelryModelResult.recordId;
    console.log("Jewelry Model created successfully with ID:", jewelryModelId);

    // Process stone details
    if (Array.isArray(stoneDetailsData) && stoneDetailsData.length > 0) {
      console.log("Processing stone details:", stoneDetailsData);

      // Ensure required fields for stone details
      const requiredStoneFields = ["name", "type", "color", "size", "Quantity"];
      const invalidStones = stoneDetailsData.filter((stone) =>
        requiredStoneFields.some((field) => !stone[field])
      );

      if (invalidStones.length > 0) {
        console.error("Some stone details are invalid:", invalidStones);
        return res.status(400).json({
          success: false,
          message: "Some stone details are invalid. Missing required fields.",
          invalidStones,
        });
      }

      const stoneRecords = stoneDetailsData.map((stone) => ({
        Name__c: stone.name,
        Stone_Type__c: stone.type,
        Color__c: stone.color,
        Stone_Size__c: stone.size,
        Quantity__c: stone.Quantity,
        Jewlery_Model__c: jewelryModelId,
      }));

      console.log("Prepared stone records for insertion:", stoneRecords);

      // Insert stone details
      const stoneDetailsResult = await conn.sobject("Stone_Details__c").insert(stoneRecords);
      const failedStones = stoneDetailsResult.filter((result) => !result.success);

      if (failedStones.length > 0) {
        console.error("Some stone details failed to insert:", JSON.stringify(failedStones, null, 2));
        return res.status(500).json({
          success: false,
          message: "Failed to add some stone details",
          failedStones,
        });
      }

      console.log("All stone details added successfully.");
    } else {
      console.warn("No stone details provided or invalid data format.");
    }

    // Success response
    res.status(200).json({
      success: true,
      message: "Jewelry model and stone details added successfully",
      jewelryModelId,
      imageUrl: jewelryModelResult.imageUrl, // Get imageUrl from the jewelry model result
    });
  } catch (error) {
    console.error("Error processing request:", error.message);
    res.status(500).json({
      success: false,
      message: "An unexpected error occurred",
      error: error.message,
    });
  }
});

// Fetch jewelry models with an optional category filter
app.get("/api/jewelry-models", checkSalesforceConnection, async (req, res) => {
  try {
    console.log("Fetching jewelry models...");
    const { Category } = req.query;

    // First get the jewelry models
    let jewelryQuery = `
      SELECT Id, Name, Category__c, Material__c, Style__c, Color__c, Purity__c, 
             Master_Weight__c, Net_Weight__c, Stone_Weight__c, Rate__c, Image_URL__c, Size__c,Gross_Weight__c
      FROM Jewlery_Model__c
    `;

    if (Category) {
      jewelryQuery += ` WHERE Category__c = '${Category}'`;
    }
    jewelryQuery += ` ORDER BY Name`;

    const result = await conn.query(jewelryQuery);

    if (result.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No jewelry models found.",
      });
    }

    // Format the response data and pass the image URLs directly
    const responseData = result.records.map((model) => ({
      Id: model.Id,
      Name: model.Name,
      Category: model.Category__c,
      Material: model.Material__c,
      Style: model.Style__c,
      Color: model.Color__c,
      Purity: model.Purity__c,
      MasterWeight: model.Master_Weight__c,
      NetWeight: model.Net_Weight__c,
      StoneWeight: model.Stone_Weight__c,
      Rate: model.Rate__c,
      GrossWeight: model.Gross_Weight__c,
      Size :model.Size__c	,
      
      // Pass through the full distribution URL
      ImageURL: model.Image_URL__c || null
    }));

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("Error fetching jewelry models:", error.message);
    res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
});

// Fetch customer Groups
app.get("/customer-groups", checkSalesforceConnection, async (req, res) => {
  try {
    const query = `
      SELECT Id,Party_Code__c
      FROM Party_Ledger__c
      ORDER BY Party_Code__c
    `;
    const result = await conn.query(query);

    if (result.records.length === 0) {
      return res.status(404).json({ success: false, message: "No customer groups found." });
    }

    res.json({ success: true, data: result.records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


/**----------------------Order Management---------------**/
app.post('/api/orders', upload.single('pdfFile'), async (req, res) => {
  try {
      const orderData = JSON.parse(req.body.orderData);
      const result = await submitOrder(conn, orderData, req.file);
      
      res.json({
          success: true,
          message: 'Order saved successfully',
          data: result
      });

  } catch (error) {
      console.error('Error saving order:', error);
      res.status(500).json({
          success: false,
          message: 'Error saving order',
          error: error.message
      });
  }
});


async function uploadFileToSalesforce(file) {
  try {
      const fileData = file.buffer;
      const fileName = `Order_${Date.now()}.pdf`;

      // Create ContentVersion
      const contentVersion = await conn.sobject('ContentVersion').create({
          Title: fileName,
          PathOnClient: fileName,
          VersionData: fileData.toString('base64'),
          IsMajorVersion: true
      });

      // Get ContentDocumentId
      const versionDetails = await conn.sobject('ContentVersion')
          .select('Id, ContentDocumentId')
          .where({ Id: contentVersion.id })
          .execute();

      return {
          id: contentVersion.id,
          contentDocumentId: versionDetails[0].ContentDocumentId
      };
  } catch (error) {
      console.error('Error uploading to Salesforce:', error);
      throw error;
  }
}

/*-------Fetch order number--------*/

app.get('/api/getLastOrderNumber', checkSalesforceConnection, async (req, res) => {
  const { partyLedgerValue } = req.query;

  if (!partyLedgerValue) {
      return res.status(400).json({
          success: false,
          message: 'partyLedgerValue is required'
      });
  }

  try {
      // Query to fetch the latest order for the given PartyLedger
      const query = `
          SELECT Order_Id__c 
          FROM Order__c
          WHERE Party_Ledger__c IN (
              SELECT Id 
              FROM Party_Ledger__c 
              WHERE Party_Code__c = '${partyLedgerValue}'
          )
          ORDER BY CreatedDate DESC
          LIMIT 1
      `;

      const result = await conn.query(query);
      console.log('Query result:', result); // Debug log

      if (result.records.length === 0) {
          // No previous orders found, return null to let frontend start from 0001
          return res.json({
              success: true,
              lastOrderNumber: null  // Changed from '${partyLedgerValue}/0000'
          });
      }

      const lastOrderNumber = result.records[0].Order_Id__c;
      console.log('Last order number:', lastOrderNumber); // Debug log

      res.json({
          success: true,
          lastOrderNumber
      });

  } catch (error) {
      console.error('Salesforce Query Error:', error);
      res.status(500).json({
          success: false,
          message: 'Error fetching order number',
          error: error.message
      });
  }
});

/*------------------Order Mangement----------*/

app.get("/api/orders", async (req, res) => {
  try {
    const query = `
      SELECT Order_Id__c, Name, Party_Name__c, Delivery_Date__c, Advance_Metal__c, 
             Status__c, Pdf__c, Purity__c,	Remarks__c,	Created_By__c,	Created_Date__c,Category__c
      FROM Order__c
    `;

    const result = await conn.query(query);

    const orders = result.records.map(order => ({
      id: order.Order_Id__c,
      partyName: order.Party_Name__c,
      deliveryDate: order.Delivery_Date__c,
      advanceMetal: order.Advance_Metal__c,
      status: order.Status__c,
      category : order.Category__c,
      pdfUrl: `/api/download-file?url=${encodeURIComponent(order.Pdf__c)}`,
      purity : order.Purity__c,
      remarks : order.Remarks__c,
      created_by : order.Created_By__c,
      created_date : order.Created_Date__c


       // Proxy PDF URL
    }));

    res.json({ success: true, data: orders });

  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ success: false, error: "Failed to fetch orders from Salesforce" });
  }
});

// Proxy Endpoint for Fetching PDFs
app.get("/api/download-file", async (req, res) => {
  try {
    const fileUrl = req.query.url;
    console.log("File URL:", fileUrl); // Log the URL for debugging
    if (!fileUrl) {
      return res.status(400).json({ success: false, error: "File URL is required" });
    }

    const response = await axios.get(fileUrl, {
      headers: {
        "Authorization": `Bearer ${process.env.SALESFORCE_ACCESS_TOKEN}`, // Ensure you have a valid token
      },
      responseType: 'stream', // Important for streaming the response
    });

    // Set headers and stream the file to the frontend
    res.setHeader("Content-Type", response.headers['content-type']);
    res.setHeader("Content-Disposition", response.headers['content-disposition']);
    response.data.pipe(res);

  } catch (error) {
    console.error("Error fetching file:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


app.post("/api/update-model", async (req, res) => {
  try {
    const { orderId, models, detailedPdf, imagesPdf } = req.body;

    if (!orderId || !models || !Array.isArray(models) || models.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data"
      });
    }

    // First, update the Order object's Department__c field to "Wax"
    

    // Continue with the rest of your existing code...
    const regularModels = models.filter(model => !model.isCanceled);
    const canceledModels = models.filter(model => model.isCanceled);

    let regularResponses = [];
    let canceledResponses = [];
    let regularPdfData = {};
    let canceledPdfData = {};

    // First verify if Order exists
    const orderQuery = await conn.query(
      `SELECT Id FROM Order__c WHERE Order_Id__c = '${orderId}' LIMIT 1`
    );

    if (!orderQuery.records || orderQuery.records.length === 0) {
      throw new Error(`Order not found with Order ID: ${orderId}`);
    }

    const salesforceOrderId = orderQuery.records[0].Id;

    // Helper function for content distribution
    const createContentDistribution = async (contentVersionId, title) => {
      try {
        const contentDistribution = await conn.sobject('ContentDistribution').create({
          Name: title,
          ContentVersionId: contentVersionId,
          PreferencesAllowViewInBrowser: true,
          PreferencesLinkLatestVersion: true,
          PreferencesNotifyOnVisit: false,
          PreferencesPasswordRequired: false,
          PreferencesAllowOriginalDownload: true
        });

        const distributionQuery = await conn.query(
          `SELECT DistributionPublicUrl FROM ContentDistribution WHERE Id = '${contentDistribution.id}'`
        );

        return distributionQuery.records[0].DistributionPublicUrl;
      } catch (error) {
        console.error('Error creating content distribution:', error);
        throw error;
      }
    };

    // Create regular models if any
    const createRegularModels = async () => {
      if (regularModels.length === 0) {
        console.log("No regular models to create");
        return [];
      }

      const modelRecords = regularModels.map(model => ({
        Name: model.item,
        Category__c: model.category,
        Purity__c: model.purity,
        Size__c: model.size,
        Color__c: model.color,
        Quantity__c: parseFloat(model.quantity) || 0,
        Gross_Weight__c: parseFloat(model.grossWeight) || 0,
        Stone_Weight__c: parseFloat(model.stoneWeight) || 0,
        Net_Weight__c: parseFloat(model.netWeight) || 0,
        Remarks__c: model.remarks,
        Order__c: salesforceOrderId
      }));

      try {
        const modelResponses = await conn.sobject('Order_Models__c').create(modelRecords);
        
        if (Array.isArray(modelResponses)) {
          const failures = modelResponses.filter(result => !result.success);
          if (failures.length > 0) {
            throw new Error(`Failed to create ${failures.length} regular models: ${JSON.stringify(failures.map(f => f.errors))}`);
          }
        }
        return modelResponses;
      } catch (error) {
        console.error('Error creating regular models:', error);
        throw error;
      }
    };

    // Create canceled models if any
    const createCanceledModels = async () => {
      if (canceledModels.length === 0) {
        console.log("No canceled models to create");
        return [];
      }

      const canceledRecords = canceledModels.map(model => ({
        Name: model.item,
        Category__c: model.category,
        Purity__c: model.purity,
        Size__c: model.size,
        Color__c: model.color,
        Quantity__c: parseFloat(model.quantity) || 0,
        Gross_Weight__c: parseFloat(model.grossWeight) || 0,
        Stone_Weight__c: parseFloat(model.stoneWeight) || 0,
        Net_Weight__c: parseFloat(model.netWeight) || 0,
        Remarks__c: model.remarks,
        Order__c: salesforceOrderId,
        //Cancellation_Date__c: new Date().toISOString()
      }));

      try {
        const canceledResponses = await conn.sobject('Order_Models_Canceled__c').create(canceledRecords);
        
        if (Array.isArray(canceledResponses)) {
          const failures = canceledResponses.filter(result => !result.success);
          if (failures.length > 0) {
            throw new Error(`Failed to create ${failures.length} canceled models: ${JSON.stringify(failures.map(f => f.errors))}`);
          }
        }
        return canceledResponses;
      } catch (error) {
        console.error('Error creating canceled models:', error);
        throw error;
      }
    };

    // Handle PDF creation for either type
    const createPDFs = async (modelId, isCanceled) => {
      try {
        const suffix = isCanceled ? 'Canceled_' : '';
        
        const detailedPdfResponse = await conn.sobject('ContentVersion').create({
          Title: `Order_${orderId}_${suffix}Detailed.pdf`,
          PathOnClient: `Order_${orderId}_${suffix}Detailed.pdf`,
          VersionData: detailedPdf
        });

        const imagesPdfResponse = await conn.sobject('ContentVersion').create({
          Title: `Order_${orderId}_${suffix}Images.pdf`,
          PathOnClient: `Order_${orderId}_${suffix}Images.pdf`,
          VersionData: imagesPdf
        });

        const detailedPdfUrl = await createContentDistribution(
          detailedPdfResponse.id,
          `Order_${orderId}_${suffix}Detailed.pdf`
        );

        const imagesPdfUrl = await createContentDistribution(
          imagesPdfResponse.id,
          `Order_${orderId}_${suffix}Images.pdf`
        );

        // Update the appropriate object
        const objectName = isCanceled ? 'Order_Models_Canceled__c' : 'Order_Models__c';
        await conn.sobject(objectName).update({
          Id: modelId,
          Order_sheet__c: detailedPdfUrl,
          Order_Image_sheet__c: imagesPdfUrl
        });

        return { detailedPdfUrl, imagesPdfUrl };
      } catch (error) {
        console.error('Error creating PDFs:', error);
        throw error;
      }
    };

    // Execute model creation
    if (regularModels.length > 0) {
      regularResponses = await createRegularModels();
      if (regularResponses.length > 0 && detailedPdf && imagesPdf) {
        regularPdfData = await createPDFs(regularResponses[0].id, false);
      }
    }

    if (canceledModels.length > 0) {
      canceledResponses = await createCanceledModels();
      if (canceledResponses.length > 0 && detailedPdf && imagesPdf) {
        canceledPdfData = await createPDFs(canceledResponses[0].id, true);
      }
    }

    res.json({
      success: true,
      message: "Models and PDFs processed successfully",
      data: {
        regularModels: regularResponses,
        canceledModels: canceledResponses,
        regularPdfs: regularPdfData,
        canceledPdfs: canceledPdfData
      }
    });

  } catch (error) {
    console.error("Error in update-model endpoint:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process models and PDFs"
    });
  }
});


/**------------Order and model fetching----------------- */
app.get("/api/order-details", async (req, res) => {
  try {
    const orderId = req.query.orderId;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required"
      });
    }

    // First, get the order details
    const orderQuery = `
      SELECT 
        Id,
        Order_Id__c,
        Party_Name__c,
        Delivery_Date__c,
        Advance_Metal__c,
        Status__c,
        Purity__c,
        Remarks__c,
        Created_By__c,
        Created_Date__c,
        Pdf__c
      FROM Order__c
      WHERE Order_Id__c = '${orderId}'
      LIMIT 1
    `;

    const orderResult = await conn.query(orderQuery);

    if (!orderResult.records || orderResult.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const orderDetails = orderResult.records[0];

    // Get regular models
    const modelsQuery = `
      SELECT 
        Id,
        Name,
        Category__c,
        Purity__c,
        Size__c,
        Color__c,
        Quantity__c,
        Gross_Weight__c,
        Stone_Weight__c,
        Net_Weight__c,
        Batch_No__c,
        Tree_No__c,
        Remarks__c,
        Order_sheet__c,
        Order_Image_sheet__c,
        Order__c
      FROM Order_Models__c
      WHERE Order__c = '${orderDetails.Id}'
    `;

    // Get canceled models
    const canceledModelsQuery = `
      SELECT 
        Id,
        Name,
        Category__c,
        Purity__c,
        Size__c,
        Color__c,
        Quantity__c,
        Gross_Weight__c,
        Stone_Weight__c,
        Net_Weight__c,
        Batch_No__c,
        Tree_No__c,
        Remarks__c,
        Order_sheet__c,
        Order_Image_sheet__c,
        Order__c
      FROM Order_Models_Canceled__c
      WHERE Order__c = '${orderDetails.Id}'
    `;

    // Execute both queries in parallel
    const [modelsResult, canceledModelsResult] = await Promise.all([
      conn.query(modelsQuery),
      conn.query(canceledModelsQuery)
    ]);

    // Format the response
    const response = {
      orderDetails: {
        orderId: orderDetails.Order_Id__c,
        partyName: orderDetails.Party_Name__c,
        deliveryDate: orderDetails.Delivery_Date__c,
        advanceMetal: orderDetails.Advance_Metal__c,
        status: orderDetails.Status__c,
        purity: orderDetails.Purity__c,
        remarks: orderDetails.Remarks__c,
        createdBy: orderDetails.Created_By__c,
        createdDate: orderDetails.Created_Date__c,
        pdf: orderDetails.Pdf__c
      },
      regularModels: modelsResult.records.map(model => ({
        id: model.Id,
        name: model.Name,
        category: model.Category__c,
        purity: model.Purity__c,
        size: model.Size__c,
        color: model.Color__c,
        quantity: model.Quantity__c,
        grossWeight: model.Gross_Weight__c,
        stoneWeight: model.Stone_Weight__c,
        netWeight: model.Net_Weight__c,
        batchNo: model.Batch_No__c,
        treeNo: model.Tree_No__c,
        remarks: model.Remarks__c,
        orderSheet: model.Order_sheet__c,
        orderImageSheet: model.Order_Image_sheet__c
      })),
      canceledModels: canceledModelsResult.records.map(model => ({
        id: model.Id,
        name: model.Name,
        category: model.Category__c,
        purity: model.Purity__c,
        size: model.Size__c,
        color: model.Color__c,
        quantity: model.Quantity__c,
        grossWeight: model.Gross_Weight__c,
        stoneWeight: model.Stone_Weight__c,
        netWeight: model.Net_Weight__c,
        batchNo: model.Batch_No__c,
        treeNo: model.Tree_No__c,
        remarks: model.Remarks__c,
        orderSheet: model.Order_sheet__c,
        orderImageSheet: model.Order_Image_sheet__c,
      }))
    };

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch order details"
    });
  }
});

/**-----------------Ordrer status------------------- */
app.post("/api/update-order-status", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required"
      });
    }

    // First get the Salesforce record ID for the order
    const orderQuery = await conn.query(
      `SELECT Id FROM Order__c WHERE Order_Id__c = '${orderId}' LIMIT 1`
    );

    if (!orderQuery.records || orderQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Update the order status
    const updateResult = await conn.sobject('Order__c').update({
      Id: orderQuery.records[0].Id,
      Status__c: 'Finished'
    });

    if (!updateResult.success) {
      throw new Error('Failed to update order status');
    }

    res.json({
      success: true,
      message: "Order status updated successfully",
      data: {
        orderId,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update order status"
    });
  }
});


/**------------------- Inventory Management-------------------- **/

app.post("/update-inventory", async (req, res) => {
  try {
    const { itemName, purity, availableWeight, unitOfMeasure } = req.body;
    
    console.log('Received inventory update request:', {
      itemName,
      purity,
      availableWeight,
      unitOfMeasure
    });

    // Validate required fields
    if (!itemName || !purity || !availableWeight || !unitOfMeasure) {
      console.log('Validation failed - missing required fields');
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // First, check if the item already exists and get its current weight
    const existingItem = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = '${itemName}' 
       AND Purity__c = '${purity}'`
    );
    
    console.log('Database query result:', {
      exists: existingItem.records.length > 0,
      currentRecord: existingItem.records[0] || 'No existing record'
    });

    let result;
    
    if (existingItem.records.length > 0) {
      // Get current weight and add new weight to it
      const currentWeight = existingItem.records[0].Available_weight__c || 0;  // Fixed field name
      const newTotalWeight = currentWeight + parseFloat(availableWeight);
      
      console.log('Weight calculation:', {
        currentWeight,
        addedWeight: parseFloat(availableWeight),
        newTotalWeight
      });
      
      // Update existing record with combined weight
      console.log('Updating existing record with new total weight:', newTotalWeight);
      result = await conn.sobject('Inventory_ledger__c').update({
        Id: existingItem.records[0].Id,
        Available_weight__c: newTotalWeight,  // Fixed field name
        Unit_of_Measure__c: unitOfMeasure,
        Last_Updated__c: new Date().toISOString()
      });
    } else {
      // Create new record
      console.log('Creating new record with initial weight:', parseFloat(availableWeight));
      result = await conn.sobject('Inventory_ledger__c').create({
        Name: itemName,
        Item_Name__c: itemName,
        Purity__c: purity,
        Available_weight__c: parseFloat(availableWeight),  // Fixed field name
        Unit_of_Measure__c: unitOfMeasure,
        Last_Updated__c: new Date().toISOString()
      });
    }

    console.log('Database operation result:', result);

    if (!result.success) {
      console.error('Database operation failed:', result);
      throw new Error('Failed to update inventory');
    }

    const responseData = {
      success: true,
      message: "Inventory updated successfully",
      data: {
        ...result,
        currentWeight: existingItem.records.length > 0 ? 
          existingItem.records[0].Available_weight__c : 0,  // Fixed field name
        addedWeight: parseFloat(availableWeight),
        newTotalWeight: existingItem.records.length > 0 ? 
          existingItem.records[0].Available_weight__c + parseFloat(availableWeight) : 
          parseFloat(availableWeight)
      }
    };

    console.log('Sending response:', responseData);
    res.status(200).json(responseData);

  } catch (error) {
    console.error("Error updating inventory:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update inventory"
    });
  }
});


app.get("/get-inventory", async (req, res) => {
  try {
    // Query to fetch inventory items with their names and available weights
    const query = `
      SELECT 
        Name,
        Item_Name__c,
        Available_weight__c,
        Purity__c
      FROM Inventory_ledger__c
      ORDER BY Name ASC
    `;

    const result = await conn.query(query);

    if (!result.records) {
      return res.status(404).json({
        success: false,
        message: "No inventory items found"
      });
    }

    // Format the response data
    // const inventoryItems = result.records.map(item => ({
    //   name: item.Item_Name__c,
    //   availableWeight: item.Available_weight__c,
    //   purity: item.Purity__c
    // }));

       const inventoryItems = result.records
  .filter(item => item.Item_Name__c?.trim().toLowerCase() !== "alloy")
  .map(item => ({
    name: item.Item_Name__c,
    availableWeight: item.Available_weight__c,
    purity: item.Purity__c
  }));

    res.status(200).json({
      success: true,
      message: "Inventory items fetched successfully",
      data: inventoryItems
    });

  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inventory items"
    });
  }
});

//    get issuded inventory items

app.get("/get-inventory-IssuedItems", async (req, res) => {
  try {
    // Query to fetch inventory items with their names and available weights
    const query = `
      SELECT 
        Issued_inventory_Name__c,
        Issued_Date__c,
        Issue_weight__c,
        Purity__c,
        Pure_Metal_weight__c,
        Alloy_Weight__c,
        Casting__c
      FROM issued_inventory_items__c
      ORDER BY Name ASC
    `;

    const result = await conn.query(query);

    if (!result.records) {
      return res.status(404).json({
        success: false,
        message: "No inventory items found"
      });
    }

    // Format the response data
    const inventoryItems = result.records.map(item => ({
      name: item.Item_Name__c,
      availableWeight: item.Available_weight__c,
      purity: item.Purity__c
    }));

    res.status(200).json({
      success: true,
      message: "Inventory items fetched successfully",
      data: inventoryItems
    });

  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inventory items"
    });
  }
});


/**--------------------------Casting Management---------- **/

app.post("/api/casting", async (req, res) => {
  try {
    const {
      castingNumber,
      date,
      orders,
      waxTreeWeight,
      purity,
      calculatedWeight,
      purityPercentages,
      requiredMetals,
      issuedItems,
      totalIssued
    } = req.body;

    console.log('Received date:', date);

    // Enhanced date formatting function
    const formatSalesforceDateTime = (dateInput) => {
      if (!dateInput) {
        throw new Error('Date is required');
      }

      let dateObj;

      // If it's already a date object
      if (dateInput instanceof Date) {
        dateObj = dateInput;
      }
      // If it's an ISO string
      else if (typeof dateInput === 'string' && dateInput.includes('-')) {
        dateObj = new Date(dateInput);
      }
      // If it's DD/MM/YYYY format
      else if (typeof dateInput === 'string' && dateInput.includes('/')) {
        const [day, month, year] = dateInput.split('/');
        // Set time to noon UTC to avoid timezone issues
        dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      } else {
        throw new Error('Invalid date format');
      }

      // Validate the date object
      if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid date');
      }

      // Return in Salesforce format
      return dateObj.toISOString();
    };

    // Validate required fields
    if (!castingNumber || !date || !orders || orders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing"
      });
    }

    const formattedDateTime = formatSalesforceDateTime(date);
    console.log('Formatted datetime:', formattedDateTime);

    // Create Casting Record
    const castingResult = await conn.sobject('Casting_dept__c').create({
      Name: castingNumber,
      Issued_Date__c: formattedDateTime,
      Wax_Tree_Weight__c: waxTreeWeight,
      Required_Purity__c: purity,
      Gold_Tree_Weight__c: calculatedWeight,
      Required_Pure_Metal_Casting__c: requiredMetals.pureGold,
      Required_Alloy_for_Casting__c: requiredMetals.alloy,
      Issud_weight__c: totalIssued,
      status__c: "Open"
    });

    if (!castingResult.success) {
      throw new Error('Failed to create casting record');
    }

    //2
    const orderQuery = await conn.query(
      `SELECT Id,Order_Id__c FROM Order__c WHERE Order_Id__c IN ('${orders.join("','")}')`
    );
    
    if (!orderQuery.records || orderQuery.records.length !== orders.length) {
      throw new Error('Some orders were not found');
    }
    
    // Log the orders we found
    console.log('Found orders:', orderQuery.records);
    
    // Update all orders at once
    const orderUpdates = orderQuery.records.map(order => ({
      Id: order.Id,   
      //Id__c: order.Id__c,              // Changed from Id_c to Id__c to match query
      Order_Id__c: order.Order_Id__c,
      Casting__c: castingResult.id,
      Casting_Id__c: castingNumber              // Changed from Casting_Id__c to id__c
    }));
    
    console.log('Attempting to update orders with:', orderUpdates);
    
    const updateResults = await conn.sobject('Order__c').update(orderUpdates);
    
    console.log('Update results:', updateResults);
    
    if (!Array.isArray(updateResults)) {
      throw new Error('Failed to update orders: Not an array response');
    }
    
    const failedUpdates = updateResults.filter(result => !result.success);
    if (failedUpdates.length > 0) {
      console.log('Failed updates:', failedUpdates);
      throw new Error(`Failed to update ${failedUpdates.length} orders. Errors: ${JSON.stringify(failedUpdates)}`);
    }

    // 3. Create Inventory Issued Records
    const inventoryIssuedPromises = issuedItems.map(async (item) => {
      const result = await conn.sobject('Issued_inventory__c').create({
        Casting__c: castingResult.id,
        Name: item.itemName,
        Issued_Date__c: formattedDateTime, // Use the formatted datetime
        Purity__c: item.purity,
        Issue_Weight__c: item.issueWeight,
        Pure_Metal_weight__c: item.issuedGold,
        Alloy_Weight__c: item.issuedAlloy
      });

      if (!result.success) {
        throw new Error(`Failed to create inventory issued record for ${item.itemName}`);
      }

      return result;
    });

    await Promise.all(inventoryIssuedPromises);

 

    // All operations successful
    res.json({
      success: true,
      message: "Casting process completed successfully",
      data: {
        castingId: castingResult.id,
        castingNumber: castingNumber,
        totalIssuedWeight: totalIssued
      }
    });

  } catch (error) {
    console.error("Error in casting process:", error);
    console.error("Received date:", req.body.date);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to complete casting process"
    });
  }
});


app.get("/api/casting", async (req, res) => {
  try {
    const query = `
      SELECT Name, Issud_weight__c, Weight_Received__c,	Received_Date__c,Issued_Date__c,status__c,Casting_Loss__c,Casting_Scrap_Weight__c,Casting_Dust_Weight__c,Casting_Ornament_Weight__c 
      FROM Casting_dept__c
    `;

    const result = await conn.query(query);

    const orders = result.records.map(order => ({
      Name: order.Name,
      Issued_weight: order.Issud_weight__c,
      Received_Weight: order.Weight_Received__c,
      Issued_Date: order.Issued_Date__c,
      Received_Date:order.Received_Date__c,
      status: order.status__c,
      Casting_Loss:order.Casting_Loss__c,
      Scrap_Weight:order.Casting_Scrap_Weight__c,
      Dust_Weight:order.Casting_Dust_Weight__c,
      Ornament_Weight:order.Casting_Ornament_Weight__c


    }));                                                

    res.json({ success: true, data: orders });

  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ success: false, error: "Failed to fetch orders from Salesforce" });
  }
});

/**--------FETCHING CASTING DATA FROM SALESFORCE --------- */
app.get("/api/casting/:date/:month/:year/:number", async (req, res) => {
  try {
    const { date, month, year, number } = req.params;
    const castingId = `${date}/${month}/${year}/${number}`;

    // Validate input
    if (!castingId) {
      return res.status(400).json({
        success: false,
        message: "Casting ID is required"
      });
    }

    // 1. Get Casting details
    const castingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Wax_Tree_Weight__c,
        Required_Purity__c,
        Gold_Tree_Weight__c,
        Required_Pure_Metal_Casting__c,
        Required_Alloy_for_Casting__c,
        Issud_weight__c
       FROM Casting_dept__c
       WHERE Name = '${castingId}'`
    );

    if (!castingQuery.records || castingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Casting not found"
      });

    }

    const casting = castingQuery.records[0];
    console.log('Found casting record:', casting);


    // 2. Get Related Orders
    const ordersQuery = await conn.query(
      `SELECT 
        Id,
        Order_Id__c,
        id__c,
        Casting__c
       FROM Order__c 
       WHERE Casting__c = '${casting.Id}'`
    );

    // 3. Get Related Inventory Items
    const inventoryQuery = await conn.query(
      `SELECT 
        Name,
        Issued_Date__c,
        Purity__c,
        Issue_Weight__c,
        Pure_Metal_weight__c,
        Alloy_Weight__c,
        Casting__c
       FROM Issued_inventory__c 
       WHERE Casting__c = '${casting.Id}'`
    );

    // 4. Prepare response
    const response = {
      success: true,
      data: {
        casting: castingQuery.records[0],
        orders: ordersQuery.records || [],
        inventoryItems: inventoryQuery.records || []
      },
      summary: {
        totalOrders: ordersQuery.records?.length || 0,
        totalInventoryItems: inventoryQuery.records?.length || 0,
        totalIssuedWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Issue_Weight__c || 0), 0) || 0,
        totalPureMetalWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Pure_Metal_weight__c || 0), 0) || 0,
        totalAlloyWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Alloy_Weight__c || 0), 0) || 0
      }
    };

    res.json(response);

      } catch (error) {
    console.error("Error fetching casting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch casting details"
    });
  }
});

/**-----------------Update Casting Received Weight ----------------- */
app.post("/api/casting/update/:date/:month/:year/:number", async (req, res) => {
  try {
    const { date, month, year, number } = req.params;
    const { receivedDate, receivedWeight, castingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight } = req.body;
    const castingNumber = `${date}/${month}/${year}/${number}`;

    // Format the received date to Salesforce format
    const formattedDate = new Date(receivedDate).toISOString();

    console.log('Looking for casting number:', castingNumber);
    console.log('Update data:', { 
      receivedDate: formattedDate, 
      receivedWeight, 
      castingLoss, 
      scrapReceivedWeight,
      dustReceivedWeight, 
      ornamentWeight 
    });

    // First get the Casting record
    const castingQuery = await conn.query(
      `SELECT Id, Name, Required_Purity__c FROM Casting_dept__c WHERE Name = '${castingNumber}'`
    );

    if (!castingQuery.records || castingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Casting not found"
      });
    }

    const casting = castingQuery.records[0];

    // Update the casting record
    const updateData = {
      Id: casting.Id,
      Received_Date__c: formattedDate,
      Weight_Received__c: receivedWeight,
      Casting_Loss__c: castingLoss,
      Casting_Scrap_Weight__c: scrapReceivedWeight,
      Casting_Dust_Weight__c: dustReceivedWeight,
      Casting_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Casting_dept__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update casting record');
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Casting Scrap'
       AND Purity__c = '91.7%'
       `
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: formattedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Casting Scrap',
          Item_Name__c: 'Casting Scrap',
          Purity__c: casting.Required_Purity__c,
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: formattedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Casting Dust' 
       AND Purity__c = '91.7%'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: formattedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Casting Dust',
          Item_Name__c: 'Casting Dust',
          Purity__c: casting.Required_Purity__c,
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: formattedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Casting and inventory updated successfully",
      data: {
        castingNumber,
        receivedDate: formattedDate,
        receivedWeight,
        castingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("Error updating casting:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update casting"
    });
  }
});

/**-----------------Get all Casting Details  ----------------- */
app.get("/api/casting/all/:date/:month/:year/:number", async (req, res) => {
  try {
    const { date, month, year, number } = req.params;
    const castingId = `${date}/${month}/${year}/${number}`;

    // Validate input
    if (!castingId) {
      return res.status(400).json({
        success: false,
        message: "Casting ID is required"
      });
    }

    // 1. Get Casting details
    const castingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issud_weight__c,
        	Weight_Received__c,
        Received_Date__c,
        Status__c,
        Casting_Loss__c
       FROM Casting_dept__c
       WHERE Name = '${castingId}'`
    );

    if (!castingQuery.records || castingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Casting not found"
      });
    }

    const casting = castingQuery.records[0];
    console.log('Found casting record:', casting);


    // 2. Get Related Orders
    const ordersQuery = await conn.query(
      `SELECT 
        Id,
        Order_Id__c,
        id__c,
        Casting__c
       FROM Order__c 
      `
       // WHERE Casting__c = '${casting.Id}'
    );

    // 3. Get Related Inventory Items
    const inventoryQuery = await conn.query(
      `SELECT 
        Name,
        Issued_Date__c,
        Purity__c,
        Issue_Weight__c,
        Pure_Metal_weight__c,
        Alloy_Weight__c,
        Casting__c
       FROM Issued_inventory__c 
       WHERE Casting__c = '${casting.Id}'`
    );

    // 4. Prepare response
    const response = {
      success: true,
      data: {
        casting: castingQuery.records[0],
        orders: ordersQuery.records || [],
        inventoryItems: inventoryQuery.records || []
      },
      summary: {
        totalOrders: ordersQuery.records?.length || 0,
        totalInventoryItems: inventoryQuery.records?.length || 0,
        totalIssuedWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Issue_Weight__c || 0), 0) || 0,
        totalPureMetalWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Pure_Metal_weight__c || 0), 0) || 0,
        totalAlloyWeight: inventoryQuery.records?.reduce((sum, item) => 
          sum + (item.Alloy_Weight__c || 0), 0) || 0
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching casting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch casting details"
    });
  }
});


/**----------------fetch Grinding pouch categories----------------- */
app.get("/api/orders/:orderId/:orderNumber/categories", async (req, res) => {
  try {
    const { orderId, orderNumber } = req.params;
    const orderIdentifier = `${orderId}/${orderNumber}`;
    console.log('Requested Order ID:', orderIdentifier);

    // First get the Order record
    const orderQuery = await conn.query(
      `SELECT Id FROM Order__c WHERE Order_Id__c = '${orderIdentifier}'`
    );

    if (!orderQuery.records || orderQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const orderSfId = orderQuery.records[0].Id;

    // Get distinct categories for this order
    const categoriesQuery = await conn.query(
      `SELECT Category__c 
       FROM Order_Models__c 
       WHERE Order__c = '${orderSfId}' 
       GROUP BY Category__c`
    );

    console.log('Found categories:', categoriesQuery.records);

    // Get all models for this order
    const modelsQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Category__c,
        Purity__c,
        Size__c,
        Color__c,
        Quantity__c,
        Gross_Weight__c,
        Stone_Weight__c,
        Net_Weight__c
       FROM Order_Models__c 
       WHERE Order__c = '${orderSfId}'`
    );

    // Group models by category
    const categorizedModels = {};
    modelsQuery.records.forEach(model => {
      const category = model.Category__c || 'Uncategorized';
      if (!categorizedModels[category]) {
        categorizedModels[category] = [];
      }
      categorizedModels[category].push(model);
    });

    res.json({
      success: true,
      data: {
        categories: categorizedModels
      },
      summary: {
        totalCategories: Object.keys(categorizedModels).length,
        totalModels: modelsQuery.records.length
      }
    });

    } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message
    });
  }
});
/**---------------- Start the Server ------------------ **/

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));


/**-----------------Grinding Details ----------------- */
app.post("/api/filing/create", async (req, res) => {
  try {
    const { 
      filingId,  
      issuedWeight, 
      issuedDate, 
      pouches,
      orderId,
      name,
      quantity,  
    } = req.body;

    console.log('Creating Filing record:', { 
      filingId,  
      issuedWeight, 
      issuedDate 
    });

    // First create the Grinding record
    const filingResult = await conn.sobject('Filing__c').create({
      Name : filingId,
      Issued_Weight__c: issuedWeight,
      Issued_Date__c: issuedDate,
      Order_Id__c:orderId,
      Product__C : name,
      Quantity__c : quantity,
      Status__c: 'In progress'
    });

    console.log('Grinding creation result:', filingResult);

    if (!filingResult.success) {
      throw new Error('Failed to create filing record');
    }

    // Create WIP pouches
    const pouchRecords = pouches.map(pouch => ({
      Name: pouch.pouchId,
      Filing__c: filingResult.id,
      Order_Id__c: pouch.orderId,
      Issued_Pouch_weight__c: pouch.weight,
      Product__c :pouch.name,
      Quantity__c:pouch.quantity
    }));

    console.log('Creating pouches:', pouchRecords);

    const pouchResults = await conn.sobject('Pouch__c').create(pouchRecords);
    console.log('Pouch creation results:', pouchResults);

    // Add this section to create pouch items with clear logging
    if (Array.isArray(pouchResults)) {
      console.log('Starting pouch items creation...');
      
      const pouchItemPromises = pouchResults.map(async (pouchResult, index) => {
        console.log(`Processing pouch ${index + 1}:`, pouchResult);
        
        if (pouches[index].categories && pouches[index].categories.length > 0) {
          console.log(`Found ${pouches[index].categories.length} categories for pouch ${index + 1}`);
          
          const pouchItemRecords = pouches[index].categories.map(category => {
            const itemRecord = {
              Name: category.category,
              WIPPouch__c: pouchResult.id,
              Category__c: category.category,
              Quantity__c: category.quantity
            };
            console.log('Creating pouch item:', itemRecord);
            return itemRecord;
          });

          try {
            console.log(`Attempting to create ${pouchItemRecords.length} pouch items`);
            const itemResults = await conn.sobject('Pouch_Items__c').create(pouchItemRecords);
            
            if (Array.isArray(itemResults)) {
              itemResults.forEach((result, i) => {
                if (result.success) {
                  console.log(`Pouch item ${i + 1} created successfully:`, result);
                } else {
                  console.error(`Pouch item ${i + 1} creation failed:`, result.errors);
                }
              });
            } else {
              if (itemResults.success) {
                console.log('Single pouch item created successfully:', itemResults);
              } else {
                console.error('Single pouch item creation failed:', itemResults.errors);
              }
            }
            
            return itemResults;
          } catch (error) {
            console.error('Error in pouch items creation:', error.message);
            console.error('Full error:', error);
            throw error;
          }
        } else {
          console.log(`No categories found for pouch ${index + 1}`);
        }
      });

      console.log('Waiting for all pouch items to be created...');
      const pouchItemResults = await Promise.all(pouchItemPromises);
      console.log('All pouch items creation completed:', pouchItemResults);
    }

    res.json({
      success: true,
      message: "Grinding record created successfully",
      data: {
        filingId,
        grindingRecordId: filingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("Error creating grinding record:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create grinding record"
    });
  }
});


app.get("/api/filing", async (req, res) => {
  try {
    console.log('Fetching filing records - API call started');

    const query = `
      SELECT 
        Name,
        Issued_weight__c,
        Issued_Date__c,
        Receievd_weight__c,
        Received_Date__c,
        Order_Id__c,
        Product__c,
        Quantity__c,
        Status__c,
        Filing_loss__c,Filing_scrap_Weight__c,Filing_Dust_Weight__c
      FROM Filing__c
      ORDER BY Issued_Date__c DESC
    `;

    console.log('Executing Salesforce query:', query);

    const result = await conn.query(query);
    console.log('Raw Salesforce response:', JSON.stringify(result, null, 2));
    console.log('Number of records found:', result.records?.length || 0);

    const filingRecords = result.records.map(record => {
      console.log('Processing record:', record.Name);
      return {
        Name: record.Name,
        Issued_Weight: record.Issued_weight__c,         // Fixed from query field
        Issued_Date: record.Issued_Date__c,
        Received_Weight: record.Receievd_weight__c,     // Fixed from query field
        Received_Date: record.Received_Date__c,
        OrderId : record.Order_Id__c,
        product : record.Product__c,
        quantity : record.Quantity__c,
        Status: record.Status__c,
        Filing_Loss: record.Filing_loss__c,
        scrapWeight:record.Filing_scrap_Weight__c,
        dustWeight:record.Filing_Dust_Weight__c
        // Fixed from query field
      };
    });

    console.log('Formatted filing records:', JSON.stringify(filingRecords, null, 2));

    const response = {
      success: true,
        data: filingRecords
    };

    console.log('Sending response to client:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error("Error in /api/grinding endpoint:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    console.error("Error stack:", error.stack);

    res.status(500).json({
      success: false,
      message: "Failed to fetch grinding records from Salesforce",
      error: error.message
    });
  }
});

/**--------------------Grinding Details ----------------- */
app.get("/api/filing/:prefix/:date/:month/:year/:number/:numb", async (req, res) => {
  try {
    const { prefix, date, month, year, number, numb } = req.params;
    const filingId = `${prefix}/${date}/${month}/${year}/${number}/${numb}`;
    
    console.log('Requested Filing ID:', filingId);

    // Query for filing details
    const filingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_weight__c,
        Receievd_weight__c,
        Received_Date__c,
        Status__c,
        Filing_loss__c
       FROM Filing__c
       WHERE Name = '${filingId}'`
    );

    console.log('Query result:', JSON.stringify(filingQuery, null, 2));

    if (!filingQuery.records || filingQuery.records.length === 0) {
      console.log('No records found for filing ID:', filingId);
      return res.status(404).json({
        success: false,
        message: "Filing record not found"
      });
    }

    const filing = filingQuery.records[0];
    console.log('Found filing record:', filing);

    // Get Related Pouches
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Filing__c,
        Issued_Pouch_weight__c
       FROM Pouch__c 
       WHERE Filing__c = '${filing.Id}'`
    );

    console.log('Found pouches:', pouchesQuery.records);

    const response = {
      success: true,
      data: {
        filing: filingQuery.records[0],
        pouches: pouchesQuery.records || []
      }
    };

    console.log('Sending response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error("Error fetching filing details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch filing details"
    });
  }
});



app.post("/api/filing/update/:prefix/:date/:month/:year/:number/:numb", async (req, res) => {
  try {
    const { prefix, date, month, year, number,numb } = req.params;
    const { receivedDate, receivedWeight, grindingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const filingNumber = `${prefix}/${date}/${month}/${year}/${number}/${numb}`;

    // Format the received date to Salesforce format
    const formattedDate = new Date(receivedDate).toISOString();

    // First get the Filing record
    const filingQuery = await conn.query(
      `SELECT Id, Name FROM Filing__c WHERE Name = '${filingNumber}'`
    );

    if (!filingQuery.records || filingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Filing record not found"
      });
    }

    const filing = filingQuery.records[0];

    // Update the filing record
    const updateData = {
      Id: filing.Id,
      Received_Date__c: formattedDate,
      Receievd_weight__c: receivedWeight,
      Filing_loss__c: grindingLoss,
      Filing_Scrap_Weight__c: scrapReceivedWeight,
      Filing_Dust_Weight__c: dustReceivedWeight,
      Filing_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Filing__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update filing record');
    }

    // Update pouch received weights using weights from request
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Pouch_weight__c: pouch.receivedWeight,
            Filing_loss_Pouch__c: grindingLoss
          });

          console.log(`[Filing Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Filing Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'scrap'
       AND Purity__c = '91.7%'
       `
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: formattedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: filing.Required_Purity__c,
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: formattedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Dust' 
       AND Purity__c = '91.7%'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: formattedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Dust',
          Item_Name__c: 'Dust',
          Purity__c: filing.Required_Purity__c,
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: formattedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Filing and inventory updated successfully",
      data: {
        filingNumber,
        receivedDate: formattedDate,
        receivedWeight,
        grindingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("Error updating filing:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update filing"
    });
  }
});

/***-------------Completed Grinding Details ----------------- */
app.get("/api/filing-details/:prefix/:date/:month/:year/:number/:numb", async (req, res) => {
  try {
    const { prefix, date, month, year, number,numb } = req.params;
    const filingId = `${prefix}/${date}/${month}/${year}/${number}/${numb}`;
        console.log('Requested Filing ID:', filingId);

    // 1. Get Grinding details
    const filingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_weight__c,
        Receievd_weight__c,
        Received_Date__c,
        Status__c,
        Filing_loss__c
       FROM Filing__c
       WHERE Name = '${filingId}'`
    );

    if (!filingQuery.records || filingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message:   "Filing record not found"
      });
    }

    const filing = filingQuery.records[0];
      console.log('Found filing record:', filing);

    // 2. Get Pouches for this grinding
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Pouch_weight__c
       FROM Pouch__c 
       WHERE Filing__c = '${filing.Id}'`
    );

    console.log('Found pouches:', pouchesQuery.records);

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];


    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;
      console.log('Found orders:', orders);

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,     
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
        console.log('Found models:', models);
      }
    }

   // 5. Organize the data hierarchically
// Then in the response construction
const response = {
  success: true,
  data: {
    filing: filing,
    pouches: pouchesQuery.records.map(pouch => {
      const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
      
      // Now models will have Order__c field to match with
      const pouchModels = relatedOrder ? models.filter(model => 
        model.Order__c === relatedOrder.Id
      ) : [];

      return {
        ...pouch,
        order: relatedOrder || null,
        models: pouchModels
      };
    })
  },
  summary: {
    totalPouches: pouchesQuery.records.length,
    totalOrders: orders.length,
    totalModels: models.length,
    totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
      sum + (pouch.Issued_Pouch_weight__c || 0), 0),
    issuedWeight: filing.Issued_weight__c,
    receivedWeight: filing.Receievd_weight__c,
    filingLoss: filing.Filing_loss__c
  }
};

// Add debug logging
console.log('Orders mapping:', orders.map(o => ({ id: o.Id, orderId: o.Order_Id__c })));
console.log('Models mapping:', models.map(m => ({ id: m.Id, orderId: m.Order__c })))


    console.log('Sending response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error("Error fetching filing details:", error);
    console.error("Fulal error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch filing details"
    });
  }
});

/***-------------Grinding Details ----------------- */
/***-------------Fetch pouch details  from filing----------------- */
app.get("/api/filing/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const filingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching pouches for filing:', filingId);

    // First get the Filing record
    const filingQuery = await conn.query(
      `SELECT Id FROM Filing__c WHERE Name = '${filingId}'`
    );

    if (!filingQuery.records || filingQuery.records.length === 0) {
      console.log('[Get Pouches] Filing not found:', filingId);
      return res.status(404).json({
        success: false,
        message: "Filing record not found"
      });
    }

    // Get pouches with their IDs and issued weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name, 
        	Received_Pouch_weight__c,
          Product__c,
          Quantity__c,
          Order_Id__c
       FROM Pouch__c 
       WHERE Filing__c = '${filingQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);

    res.json({
      success: true,
      data: {
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches"
    });
  }
});



app.post("/api/grinding/create", async (req, res) => {
  try {
    const { 
      grindingId,
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    console.log('[Grinding Create] Received data:', { 
      grindingId,
      issuedDate,
      pouchCount: pouches.length,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    });

    // First create the Grinding record
    const grindingResult = await conn.sobject('Grinding__c').create({
      Name: grindingId,
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__c:product,
      Quantity__c:quantity,
      Order_Id__c: orderId
    });

    console.log('[Grinding Create] Grinding record created:', grindingResult);

    if (!grindingResult.success) {
      throw new Error('Failed to create grinding record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Grinding Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.grindingWeight
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Grinding__c: grindingResult.id,
        Isssued_Weight_Grinding__c: pouch.grindingWeight,
        Quantity__c: pouch.quantity
      });

      console.log('[Grinding Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Grinding record created successfully",
      data: {
        grindingId: grindingId,
        grindingRecordId: grindingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("[Grinding Create] Error:", error);
    console.error("[Grinding Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create grinding record"
    });
  }
});

app.get("/api/grinding", async(req, res) => {
  try {
    const grindingQuery = await conn.query(
       `SELECT Id, Name, Issued_Date__c, Issued_Weight__c,Received_Date__c,Received_Weight__c,Status__c,Grinding_loss__c,Product__c,Quantity__c,Order_Id__c,Grinding_Scrap_Weight__C,Grinding_Dust_Weight__c FROM Grinding__c
       ORDER BY Issued_Date__c DESC`
    );

    res.json({
      success: true,
      data: grindingQuery.records
    });
  } catch (error) {
    console.error("Error fetching grinding records:", error); 
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch grinding records"
    });
  }
});

app.get("/api/grinding/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const grindingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('Requested Grinding ID:', grindingId);

    // Query for grinding details
    const grindingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Received_Weight__c,
        Received_Date__c,
        Product__c,
        Quantity__c,
      	Order_Id__c,
        status__c,
        Grinding_loss__c
       FROM Grinding__c
       WHERE Name = '${grindingId}'`
    );

    if (!grindingQuery.records || grindingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grinding record not found"
      });
    }

    const grinding = grindingQuery.records[0];

    // Get Related Pouches
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Grinding__c,
        Isssued_Weight_Grinding__c,
        Product__c,
        Quantity__c
       FROM Pouch__c 
       WHERE Grinding__c = '${grinding.Id}'`
    );

    const response = {
      success: true,
      data: {
        grinding: grindingQuery.records[0],
        pouches: pouchesQuery.records || []
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching grinding details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch grinding details"
    });
  }
});

/**-----------------Get all Grinding Details ----------------- */
app.get("/api/grinding-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const grindingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Grinding details
    const grindingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Received_Weight__c,
        Received_Date__c,
        Status__c,
        Grinding_loss__c
       FROM Grinding__c
       WHERE Name = '${grindingId}'`
    );

    if (!grindingQuery.records || grindingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grinding record not found"
      });
    }

    const grinding = grindingQuery.records[0];

    // 2. Get Pouches for this grinding
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Isssued_Weight_Grinding__c
       FROM Pouch__c 
       WHERE Grinding__c = '${grinding.Id}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,     
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        grinding: grinding,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
          sum + (pouch.Isssued_Weight_Grinding__c || 0), 0),
        issuedWeight: grinding.Issued_Weight__c,
        receivedWeight: grinding.Received_Weight__c,
        grindingLoss: grinding.Grinding_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching grinding details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch grinding details"
    });
  }
});

/**----------------- Update Grinding Received Weight -----------------*/
app.post("/api/grinding/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;

    // Default missing numeric values to 0
    let {
      receivedDate,
      receivedWeight = 0,
      grindingLoss = 0,
      scrapReceivedWeight = 0,
      dustReceivedWeight = 0,
      ornamentWeight = 0,
      pouches = []
    } = req.body;

    // Ensure numeric values
    receivedWeight = Number(receivedWeight) || 0;
    grindingLoss = Number(grindingLoss) || 0;
    scrapReceivedWeight = Number(scrapReceivedWeight) || 0;
    dustReceivedWeight = Number(dustReceivedWeight) || 0;
    ornamentWeight = Number(ornamentWeight) || 0;

    const grindingNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log("[Grinding Update] Received data:", {
      grindingNumber,
      receivedDate,
      receivedWeight,
      grindingLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches
    });

    /** ---- 1. Get Grinding Record ---- **/
    const grindingQuery = await conn.query(
       `SELECT Id, Name FROM Grinding__c WHERE Name = '${grindingNumber}'`
    );

    if (!grindingQuery.records || grindingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grinding record not found"
      });
    }

    const grinding = grindingQuery.records[0];

    /** ---- 2. Update Grinding Record ---- **/
    const updateData = {
      Id: grinding.Id,
      Received_Date__c: receivedDate,
      Received_Weight__c: receivedWeight,
      Grinding_loss__c: grindingLoss,
      Grinding_Scrap_Weight__c: scrapReceivedWeight,
      Grinding_Dust_Weight__c: dustReceivedWeight,
      Grinding_Ornament_Weight__c: ornamentWeight,
      Status__c: "Finished"
    };

    const updateResult = await conn.sobject("Grinding__c").update(updateData);

    if (!updateResult.success) {
      throw new Error("Failed to update grinding record");
    }

    /** ---- 3. Update Pouches ---- **/
    if (Array.isArray(pouches) && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject("Pouch__c").update({
            Id: pouch.pouchId,
            Received_Weight_Grinding__c: Number(pouch.receivedWeight) || 0,
            Grinding_Loss__c: grindingLoss
          });

          console.log(
            `[Grinding Update] Pouch update result for ${pouch.pouchId}:`,
            pouchUpdateResult
          );
        } catch (pouchError) {
          console.error(
            `[Grinding Update] Failed to update pouch ${pouch.pouchId}:`,
            pouchError
          );
          throw pouchError;
        }
      }
    }

    /** ---- 4. Scrap Inventory Update ---- **/
    if (scrapReceivedWeight > 0) {
      const scrapInventoryQuery = await conn.query(
        `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
      AND Purity__c = '91.7%'`
      );

      if (scrapInventoryQuery.records.length > 0) {
        const currentWeight =
          scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn
          .sobject("Inventory_ledger__c")
          .update({
            Id: scrapInventoryQuery.records[0].Id,
            Available_weight__c: currentWeight + scrapReceivedWeight,
            Last_Updated__c: receivedDate
          });

        if (!scrapUpdateResult.success) {
          throw new Error("Failed to update scrap inventory");
        }
      } else {
        const scrapCreateResult = await conn
          .sobject("Inventory_ledger__c")
          .create({
            Name: "Scrap",
            Item_Name__c: "Scrap",
            Purity__c: grinding.Purity__c,
            Available_weight__c: scrapReceivedWeight,
            Unit_of_Measure__c: "Grams",
            Last_Updated__c: receivedDate
          });

        if (!scrapCreateResult.success) {
          throw new Error("Failed to create scrap inventory");
        }
      }
    }

    /** ---- 5. Dust Inventory Update ---- **/
    if (dustReceivedWeight > 0) {
      const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c ,Purity__c FROM Inventory_ledger__c 
     WHERE Item_Name__c = 'G Machine Dust' and Purity__c ='91.7%'`
      );

      if (dustInventoryQuery.records.length > 0) {
        const currentWeight =
          dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn
          .sobject("Inventory_ledger__c")
          .update({
            Id: dustInventoryQuery.records[0].Id,
            Available_weight__c: currentWeight + dustReceivedWeight,
            Last_Updated__c: receivedDate
          });

        if (!dustUpdateResult.success) {
          throw new Error("Failed to update dust inventory");
        }
      } else {
        const dustCreateResult = await conn
          .sobject("Inventory_ledger__c")
          .create({
            Name: "G Machine Dust",
            Item_Name__c: "G Machine Dust",
            Purity__c: grinding.Purity__c,
            Available_weight__c: dustReceivedWeight,
            Unit_of_Measure__c: "Grams",
            Last_Updated__c: receivedDate
          });

        if (!dustCreateResult.success) {
          throw new Error("Failed to create dust inventory");
        }
      }
    }

    /** ---- 6. Response ---- **/
    res.json({
      success: true,
      message: "Grinding record updated successfully",
      data: {
        grindingNumber,
        receivedDate,
        receivedWeight,
        grindingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: "Finished"
      }
    });
  } catch (error) {
    console.error("[Grinding Update] Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update grinding record"
    });
  }
});


/**----------------- Update Inventory Weights for Casting ----------------- **/
app.put("/api/update-inventoryweights", async (req, res) => {
  try {
    const { issuedItems } = req.body;
    
    console.log('Received inventory weight update request:', {
      issuedItems
    });

    if (!issuedItems || !Array.isArray(issuedItems) || issuedItems.length === 0) {
      console.log('Validation failed - invalid or missing issuedItems');
      return res.status(400).json({
        success: false,
        message: "Valid issuedItems array is required"
      });
    }

    const updateResults = [];

    // Process each issued item
    for (const item of issuedItems) {
      console.log('Processing item:', item);

      // Get current inventory
      const existingItem = await conn.query(
        `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
         WHERE Item_Name__c = '${item.itemName}' 
         AND Purity__c = '${item.purity}'`
      );

      console.log('Current inventory for item:', {
        itemName: item.itemName,
        currentRecord: existingItem.records[0] || 'No existing record'
      });

      if (!existingItem.records || existingItem.records.length === 0) {
        console.error(`Inventory item not found: ${item.itemName} (${item.purity})`);
        throw new Error(`Inventory item not found: ${item.itemName} (${item.purity})`);
      }

      const currentWeight = existingItem.records[0].Available_weight__c || 0;
      const deductWeight = parseFloat(item.issueWeight);
      const newWeight = currentWeight - deductWeight;

      console.log('Weight calculation:', {
        itemName: item.itemName,
        currentWeight,
        deductWeight,
        newWeight
      });

      if (newWeight < 0) {
        throw new Error(`Insufficient inventory for ${item.itemName} (${item.purity}). Available: ${currentWeight}, Required: ${deductWeight}`);
      }

      // Update inventory with new weight
      const result = await conn.sobject('Inventory_ledger__c').update({
        Id: existingItem.records[0].Id,
        Available_weight__c: newWeight,
        Last_Updated__c: new Date().toISOString()
      });

      console.log('Update result for item:', {
        itemName: item.itemName,
        result
      });

      updateResults.push({
        itemName: item.itemName,
        purity: item.purity,
        previousWeight: currentWeight,
        deductedWeight: deductWeight,
        newWeight: newWeight,
        success: result.success
      });
    }

    const responseData = {
      success: true,
      message: "Inventory weights updated successfully",
      data: updateResults
    };

    console.log('Sending response:', responseData);
    res.status(200).json(responseData);

  } catch (error) {
    console.error("Error updating inventory weights:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update inventory weights"
    });
  }
});

/**-----------------Setting Details ----------------- */
app.get("/api/setting/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const settingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('Requested Setting ID:', settingId);

    // Query for setting details
    const settingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Setting_l__c
       FROM Setting__c
       WHERE Name = '${settingId}'`
    );

    if (!settingQuery.records || settingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Setting record not found"
      });
    }

    const setting = settingQuery.records[0];

    // Get Related Pouches
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Setting__c,
        Issued_weight_setting__c
       FROM Pouch__c 
       WHERE Setting__c = '${setting.Id}'`
    );

    const response = {
      success: true,
      data: {
        setting: settingQuery.records[0],
        pouches: pouchesQuery.records || []
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching setting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch setting details"
    });
  }
});

/**-----------------Get all Setting Details ----------------- */
app.get("/api/setting-details/:prefix/:date/:month/:year/:number/:subm", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const settingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Setting details
    const settingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Setting_l__c
       FROM Setting__c
       WHERE Name = '${settingId}'`
    );

    if (!settingQuery.records || settingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Setting record not found"
      });
    }

    const setting = settingQuery.records[0];

    // 2. Get Pouches for this setting
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_weight_setting__c
       FROM Pouch__c 
       WHERE Setting__c = '${setting.Id}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,     
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        setting: setting,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_weight_setting__c || 0), 0),
        issuedWeight: setting.Issued_Weight__c,
        receivedWeight: setting.Returned_weight__c,
        settingLoss: setting.Setting_l__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching setting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch setting details"
    });
  }
});


/**-----------------Update Setting Received Weight ----------------- */
app.post("/api/setting/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const { receivedDate, receivedWeight, settingLoss, scrapReceivedWeight, dustReceivedWeight, totalStoneWeight, ornamentWeight, pouches } = req.body;
    const settingNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log('[Setting Update] Received data:', { 
      settingNumber, 
      receivedDate, 
      receivedWeight, 
      settingLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches 
    });

    // First get the Setting record
    const settingQuery = await conn.query(
      `SELECT Id, Name FROM Setting__c WHERE Name = '${settingNumber}'`
    );

    if (!settingQuery.records || settingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Setting record not found"
      });
    }

    const setting = settingQuery.records[0];

    // Update the setting record
    const updateData = {
      Id: setting.Id,
      Received_Date__c: receivedDate,
      Returned_weight__c: receivedWeight,
      Setting_l__c: settingLoss,
      Stone_Weight__c: totalStoneWeight,
      Setting_Scrap_Weight__c: scrapReceivedWeight,
      Setting_Dust_Weight__c: dustReceivedWeight,
      Setting_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Setting__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update setting record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Setting__c: pouch.receivedWeight,
            Stone_Weight_Setting__c: pouch.stoneWeight,
            	Setting_loss__c: pouch.settingLoss
          });

          console.log(`[Setting Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Setting Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '91.7%'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: setting.Purity__c,
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Setting Dust' 
       AND Purity__c = '91.7%'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Setting Dust',
          Item_Name__c: 'Setting Dust',
          Purity__c: setting.Purity__c,
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Setting record updated successfully",
      data: {
        settingNumber,
        receivedDate,
        receivedWeight,
        settingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Setting Update] Error:", error);
    console.error("[Setting Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update setting record"
    });
  }
});
/***-------------Fetch pouch details from grinding----------------- */
app.get("/api/grinding/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const grindingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching pouches for grinding:', grindingId);

    // First get the Grinding record
    const grindingQuery = await conn.query(
      `SELECT Id FROM Grinding__c WHERE Name = '${grindingId}'`
    );

    if (!grindingQuery.records || grindingQuery.records.length === 0) {
      console.log('[Get Pouches] Grinding not found:', grindingId);
      return res.status(404).json({
        success: false,
        message: "Grinding record not found"
      });
    }

    // Get pouches with their IDs and issued weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Isssued_Weight_Grinding__c,
        Received_Weight_Grinding__c,
        Product__c,
        Quantity__c,
        Order_Id__c
       FROM Pouch__c 
       WHERE Grinding__c = '${grindingQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);

    res.json({
      success: true,
      data: {
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches"
    });
  }
});

app.post("/api/setting/create", async (req, res) => {
  try {
    const { 
      settingId,
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    console.log('[Setting Create] Received data:', { 
      settingId,
      issuedDate,
      pouchCount: pouches.length,
      totalWeight,
      status
    });

    // First create the Setting record
    const settingResult = await conn.sobject('Setting__c').create({
      Name: settingId,
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__C : product,
      Quantity__c : quantity,
      Order_Id__c : orderId

    });

    console.log('[Setting Create] Setting record created:', settingResult);

    if (!settingResult.success) {
      throw new Error('Failed to create setting record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Setting Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.settingWeight
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Setting__c: settingResult.id,
        Issued_weight_setting__c: pouch.settingWeight,
        Product__c :pouch.product,
        Quantity__c :pouch.quantity
      });

      console.log('[Setting Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Setting record created successfully",
      data: {
        settingId: settingId,
        settingRecordId: settingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("[Setting Create] Error:", error);
    console.error("[Setting Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create setting record"
    });
  }
});

/**----------------- Get All Settings ----------------- */
app.get("/api/setting", async (req, res) => {
  try {
    console.log('[Get Settings] Fetching all setting records');

    const settingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        status__c,
        Product__c,
        Quantity__c,
        Order_Id__c,
        Stone_Weight__c,
        Setting_l__c,
        CreatedDate
       FROM Setting__c
       ORDER BY CreatedDate DESC`
    );

    console.log('[Get Settings] Found settings:', settingQuery.records.length);

    res.json({
      success: true,
      data: settingQuery.records
    });

  } catch (error) {
    console.error("[Get Settings] Error:", error);
    console.error("[Get Settings] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch setting records"
    });
  }
});

app.get("/api/setting/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const settingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching pouches for setting:', settingId);

    // First get the Setting record
    const settingQuery = await conn.query(
      `SELECT Id FROM Setting__c WHERE Name = '${settingId}'`
    );

    if (!settingQuery.records || settingQuery.records.length === 0) {
      console.log('[Get Pouches] Setting not found:', settingId);
      return res.status(404).json({
        success: false,
        message: "Setting record not found"
      });
    }

    // Get pouches with their IDs and issued weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_weight_setting__c,
        Received_Weight_Setting__c,
        Product__c,
        Quantity__c,
        Order_Id__c
       FROM Pouch__c 
       WHERE Setting__c = '${settingQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);

    res.json({
      success: true,
      data: {
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches"
    });
  }
});

app.post("/api/polishing/create", async (req, res) => {
  try {
    const { 
      polishingId,
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    console.log('[Polishing Create] Received data:', { 
      polishingId,
      issuedDate,
      pouchCount: pouches.length,
      totalWeight,
      status,
      product,
      quantity
    });

    // First create the Polishing record
    const polishingResult = await conn.sobject('Polishing__c').create({
      Name: polishingId,
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__c: product,
      Quantity__c: quantity,
      Order_Id__c :orderId
    });

    console.log('[Polishing Create] Polishing record created:', polishingResult);

    if (!polishingResult.success) {
      throw new Error('Failed to create polishing record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Polishing Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.polishingWeight
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Polishing__c: polishingResult.id,
        Issued_Weight_Polishing__c: pouch.polishingWeight,
        Product__c: product,
        Quantity__c : quantity
       
      });

      console.log('[Polishing Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Polishing record created successfully",
      data: {
        polishingId: polishingId,
        polishingRecordId: polishingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("[Polishing Create] Error:", error);
    console.error("[Polishing Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create polishing record"
    });
  }
});

/**----------------- Get All Polishing Records ----------------- */
app.get("/api/polishing", async (req, res) => {
  try {
    console.log('[Get Polishing] Fetching all polishing records');

    const polishingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Received_Weight__c,
        Received_Date__c,
        Quantity__c,
        Order_Id__c,
        Product__c,
        status__c,
        Polishing_loss__c,
        CreatedDate,Polishing_Scrap_Weight__c,Polishing_Dust_Weight__c
       FROM Polishing__c
       ORDER BY CreatedDate DESC`
    );

    console.log('[Get Polishing] Found polishing records:', polishingQuery.records.length);

    res.json({
      success: true,
      data: polishingQuery.records
    });

  } catch (error) {
    console.error("[Get Polishing] Error:", error);
    console.error("[Get Polishing] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch polishing records"
    });
  }
});

/**----------------- Get Pouches for Polishing ----------------- */
app.get("/api/polishing/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const polishingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching pouches for polishing:', polishingId);

    // First get the Polishing record with all details
    const polishingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Received_Weight__c,
        Received_Date__c,
        Status__c,
        Polishing_loss__c
       FROM Polishing__c 
       WHERE Name = '${polishingId}'`
    );

    if (!polishingQuery.records || polishingQuery.records.length === 0) {
      console.log('[Get Pouches] Polishing not found:', polishingId);
      return res.status(404).json({
        success: false,
        message: "Polishing record not found"
      });
    }

    // Get pouches with their IDs and issued weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Order_Id__c,
        Issued_Weight_Polishing__c,
        Received_Weight_Polishing__c,
        Polishing_Loss__c
       FROM Pouch__c 
       WHERE Polishing__c = '${polishingQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);

    res.json({
      success: true,
      data: {
        polishing: polishingQuery.records[0],
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches"
    });
  }
});

/**-----------------Update Polishing Received Weight ----------------- */
app.post("/api/polishing/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const { receivedDate, receivedWeight, polishingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const polishingNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log('[Polishing Update] Received data:', { 
      polishingNumber, 
      receivedDate, 
      receivedWeight, 
      polishingLoss, 
      pouches 
    });

    // First get the Polishing record
    const polishingQuery = await conn.query(
      `SELECT Id, Name FROM Polishing__c WHERE Name = '${polishingNumber}'`
    );

    if (!polishingQuery.records || polishingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Polishing record not found"
      });
    }

    const polishing = polishingQuery.records[0];

    // Update the polishing record
    const updateData = {
      Id: polishing.Id,
      Received_Date__c: receivedDate,
      Received_Weight__c: receivedWeight,
      Polishing_loss__c: polishingLoss,
      Polishing_Scrap_Weight__c: scrapReceivedWeight,
      Polishing_Dust_Weight__c: dustReceivedWeight,
      Polishing_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Polishing__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update polishing record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Polishing__c: pouch.receivedWeight,
            Polishing_Loss__c: polishingLoss
          });

          console.log(`[Polishing Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Polishing Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '91.7%'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: polishing.Purity__c,
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'P Machine Dust' 
       AND Purity__c = '91.7%'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'P Machine Dust',
          Item_Name__c: 'P Machine Dust',
          Purity__c: polishing.Purity__c,
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Polishing record updated successfully",
      data: {
        polishingNumber,
        receivedDate,
        receivedWeight,
        polishingLoss,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Polishing Update] Error:", error);
    console.error("[Polishing Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update polishing record"
    });
  }
});


/**-----------------Get all Polishing Details ----------------- */
app.get("/api/polishing-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const polishingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Polishing details
    const polishingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Received_Weight__c,
        Received_Date__c,
        Status__c,
        Polishing_loss__c
       FROM Polishing__c
       WHERE Name = '${polishingId}'`
    );

    if (!polishingQuery.records || polishingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Polishing record not found"
      });
    }

    const polishing = polishingQuery.records[0];

    // 2. Get Pouches for this polishing
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Weight_Polishing__c,
        Received_Weight_Polishing__c
       FROM Pouch__c 
       WHERE Polishing__c = '${polishing.Id}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,     
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        polishing: polishing,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_Weight_Polishing__c || 0), 0),
        issuedWeight: polishing.Issued_Weight__c,
        receivedWeight: polishing.Received_Weight__c,
        polishingLoss: polishing.Polishing_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching polishing details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch polishing details"
    });
  }
});


/**----------------- Get Pouches from Polishing ----------------- */
app.get("/api/polish/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const polishingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching pouches for polishing:', polishingId);

    // First get the Polishing record
    const polishingQuery = await conn.query(
      `SELECT Id FROM Polishing__c WHERE Name = '${polishingId}'`
    );

    if (!polishingQuery.records || polishingQuery.records.length === 0) {
      console.log('[Get Pouches] Polishing not found:', polishingId);
      return res.status(404).json({
        success: false,
        message: "Polishing record not found"
      });
    }

    // Get pouches with their IDs and issued weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_Weight_Polishing__c,
        Received_Weight_Polishing__c,
        Product__c,
        Quantity__c,
        Order_Id__c
        FROM Pouch__c 
       WHERE Polishing__c = '${polishingQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);

    res.json({
      success: true,
      data: {
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches"
    });
  }
});

app.post("/api/dull/create", async (req, res) => {
  try {
    const { 
      dullId,
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    console.log('[Dull Create] Received data:', { 
      dullId,
      issuedDate,
      pouchCount: pouches.length,
      totalWeight,
      status
    });

    // First create the Dull record
    const dullResult = await conn.sobject('Dull__c').create({
      Name: dullId,
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__c : product,
      Quantity__c : quantity,
      Order_Id__c : orderId

    });

    console.log('[Dull Create] Dull record created:', dullResult);

    if (!dullResult.success) {
      throw new Error('Failed to create dull record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Dull Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.dullWeight
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Dull__c: dullResult.id,
        Issued_Weight_Dull__c: pouch.dullWeight,
        Product__c : pouch.product,
        Quantity__c : pouch.quantity

      });

      console.log('[Dull Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Dull record created successfully",
      data: {
        dullId: dullId,
        dullRecordId: dullResult.id,
        pouches: pouchResults
      }
    });


  } catch (error) {
    console.error("[Dull Create] Error:", error);
    console.error("[Dull Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create dull record"
    });
  }
});

/**----------------- Get All Dull Records ----------------- */
app.get("/api/dull", async (req, res) => {
  try {
    console.log('[Get Dull] Fetching all dull records');

    const dullQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        	Returned_weight__c,
        Received_Date__c,
        status__c,
        Order_Id__c,
        Product__c,
        Quantity__c,
        Dull_loss__c,
        CreatedDate
       FROM Dull__c
       ORDER BY CreatedDate DESC`
    );

    console.log('[Get Dull] Found dull records:', dullQuery.records.length);

    res.json({
      success: true,
      data: dullQuery.records
    });

  } catch (error) {
    console.error("[Get Dull] Error:", error);
    console.error("[Get Dull] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch dull records"
    });
  }
});

/**----------------- Get Pouches for Dull ----------------- */
/**----------------- Get Pouches for Dull ----------------- */
app.get("/api/dull/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const dullId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Pouches] Fetching details for dull:', dullId);

    // First get the Dull record with all fields
    const dullQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Dull_Loss__c
       FROM Dull__c 
       WHERE Name = '${dullId}'`
    );

    if (!dullQuery.records || dullQuery.records.length === 0) {
      console.log('[Get Pouches] Dull not found:', dullId);
      return res.status(404).json({
        success: false,
        message: "Dull record not found"
      });
    }

    // Get pouches with their IDs and weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_Weight_Dull__c,
        Received_Weight_Dull__c,
        Quantity__c,
        Product__c,
        Order_Id__c
       FROM Pouch__c 
       WHERE Dull__c = '${dullQuery.records[0].Id}'`
    );

    console.log('[Get Pouches] Found pouches:', pouchesQuery.records);
    console.log('[Get Pouches] Dull details:', dullQuery.records[0]);

    res.json({
      success: true,
      data: {
        dull: dullQuery.records[0],
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dull details"
    });
  }
});

/**-----------------Update Dull Received Weight ----------------- */
app.post("/api/dull/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const { receivedDate, receivedWeight, dullLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const dullNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log('[Dull Update] Received data:', { 
      dullNumber, 
      receivedDate, 
      receivedWeight, 
      dullLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches 
    });

    // First get the Dull record
    const dullQuery = await conn.query(
      `SELECT Id, Name FROM Dull__c WHERE Name = '${dullNumber}'`
    );

    if (!dullQuery.records || dullQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Dull record not found"
      });
    }

    const dull = dullQuery.records[0];

    // Update the dull record
    const updateData = {
      Id: dull.Id,
      Received_Date__c: receivedDate,
      Returned_weight__c: receivedWeight,
      Dull_loss__c: dullLoss,
      Dull_Scrap_Weight__c: scrapReceivedWeight,
      Dull_Dust_Weight__c: dustReceivedWeight,
      Dull_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Dull__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update dull record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Dull__c: pouch.receivedWeight,
            Dull_Loss__c: dullLoss
          });

          console.log(`[Dull Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Dull Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '91.7%'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: dull.Purity__c,
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Dust' 
       AND Purity__c = '91.7%'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Dust',
          Item_Name__c: 'Dust',
          Purity__c: dull.Purity__c,
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Dull record updated successfully",
      data: {
        dullNumber,
        receivedDate,
        receivedWeight,
        dullLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Dull Update] Error:", error);
    console.error("[Dull Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update dull record"
    });
  }
});

/**-----------------Get all Dull Details ----------------- */
app.get("/api/dull-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const dullId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Dull details
    const dullQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Dull_loss__c
       FROM Dull__c
       WHERE Name = '${dullId}'`
    );

    if (!dullQuery.records || dullQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Dull record not found"
      });
    }

    const dull = dullQuery.records[0];

    // 2. Get Pouches for this dull
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Weight_Dull__c,
        Received_Weight_Dull__c
       FROM Pouch__c 
       WHERE Dull__c = '${dull.Id}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,     
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        dull: dull,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_Weight_Dull__c || 0), 0),
        issuedWeight: dull.Issued_Weight__c,
        receivedWeight: dull.Returned_weight__c,
        dullLoss: dull.Dull_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching dull details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch dull details"
    });
  }
});

// ... existing code ...

/**----------------- Get Orders By Party ----------------- */
/**----------------- Get Orders By Party For Tagging ----------------- */
app.get("/api/taggingorders", async (req, res) => {
  try {
    const { partyCode } = req.query;
    console.log('[Get Orders] Fetching orders for party:', partyCode);

    const query = `
      SELECT Order_Id__c
      FROM Order__c 
      WHERE Party_Code__c = '${partyCode}'
      ORDER BY CreatedDate DESC`;

    const result = await conn.query(query);
    
    res.json({
      success: true,
      data: result.records.map(order => order.Order_Id__c)
    });

  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders"
    });
  }
});

/**----------------- Get Model Names By Order ID For Tagging ----------------- */
app.get("/api/tagging-order-models", async (req, res) => {
  try {
    const { orderId } = req.query;
    console.log('[Get Order Models] Fetching models for order:', orderId);

    // First get the Order record to get its Salesforce ID
    const orderQuery = await conn.query(
      `SELECT Id FROM Order__c WHERE Order_Id__c = '${orderId}'`
    );

    if (!orderQuery.records || orderQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Get just the model names
    const modelsQuery = await conn.query(
      `SELECT Name 
       FROM Order_Models__c 
       WHERE Order__c = '${orderQuery.records[0].Id}'`
    );

    res.json({
      success: true,
      data: modelsQuery.records.map(model => model.Name)
    });

  } catch (error) {
    console.error("Error fetching order models:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order models"
    });
  }
});

/**----------------- Get Model Image ----------------- */
app.get("/api/model-image", async (req, res) => {
  try {
    const { modelCode } = req.query;
    console.log('[Get Model Image] Starting request for model:', modelCode);

    // Check and refresh Salesforce connection if needed
    if (!conn || !conn.accessToken) {
      console.log('[Get Model Image] Refreshing Salesforce connection...');
      await connectToSalesforce();
    }

    // Query Salesforce for the model record
    const query = `SELECT Image_URL__c FROM Jewlery_Model__c WHERE Name = '${modelCode}'`;
    const modelQuery = await conn.query(query);

    if (!modelQuery?.records || modelQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No records found for model: ${modelCode}`
      });
    }

    const imageUrl = modelQuery.records[0].Image_URL__c;
    if (!imageUrl) {
      return res.status(404).json({
        success: false,
        message: `No image URL for model: ${modelCode}`
      });
    }

    // Return URL that points to our download endpoint
    const downloadUrl = `/api/download-file?url=${encodeURIComponent(imageUrl)}`;

    res.json({
      success: true,
      data: downloadUrl
    });

  } catch (error) {
    console.error('[Get Model Image] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch model image URL'
    });
  }
});



/**----------------- Create Tagged Item ----------------- */
app.post("/api/create-tagged-item", upload.single('pdf'), async (req, res) => {
  try {
    let pdfUrl = null;
    
    if (req.file) {
      // Create ContentVersion
      const contentVersion = await conn.sobject('ContentVersion').create({
        Title: `${req.body.taggingId}_${req.body.modelDetails}`,
        PathOnClient: req.file.originalname,
        VersionData: req.file.buffer.toString('base64'),
        IsMajorVersion: true
      });

      // Get ContentDocumentId
      const [versionDetails] = await conn.sobject('ContentVersion')
        .select('Id, ContentDocumentId')
        .where({ Id: contentVersion.id })
        .execute();

      // Create ContentDistribution
      const distribution = await conn.sobject('ContentDistribution').create({
        Name: `${req.body.taggingId}_${req.body.modelDetails}`,
        ContentVersionId: contentVersion.id,
        PreferencesAllowViewInBrowser: true,
        PreferencesLinkLatestVersion: true,
        PreferencesNotifyOnVisit: false,
        PreferencesPasswordRequired: false,
        PreferencesExpires: false
      });

      // Get Distribution URL
      const [distributionDetails] = await conn.sobject('ContentDistribution')
        .select('ContentDownloadUrl, DistributionPublicUrl')
        .where({ Id: distribution.id })
        .execute();

      pdfUrl = distributionDetails.ContentDownloadUrl;
    }

    // Create Tagged Item
    const taggedItem = {
      Name: req.body.modelDetails,
      Model_Unique_Number__c: req.body.modelUniqueNumber,
      Gross_Weight__c: Number(req.body.grossWeight).toFixed(3),
      Net_Weight__c: Number(req.body.netWeight).toFixed(3),
      Stone_Weight__c: Number(req.body.stoneWeight).toFixed(3),
      Stone_Charge__c: Number(req.body.stoneCharge),
      model_details__c: pdfUrl,
      Tagging_ID__c: req.body.taggingId
    };

    const result = await conn.sobject('Tagged_item__c').create(taggedItem);

    // Send Response with URL
    res.json({
      success: true,
      data: {
        id: result.id,
        taggingId: req.body.taggingId,
        modelDetails: req.body.modelDetails,
        modelUniqueNumber: req.body.modelUniqueNumber,
        grossWeight: Number(req.body.grossWeight).toFixed(3),
        netWeight: Number(req.body.netWeight).toFixed(3),
        stoneWeight: Number(req.body.stoneWeight).toFixed(3),
        stoneCharge: Number(req.body.stoneCharge),
        pdfUrl: pdfUrl // Just send the URL directly
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create tagged item",
      error: error.message
    });
  }
});


/**----------------- Submit Tagging ----------------- */
app.post("/api/submit-tagging", upload.fields([
  { name: 'pdfFile', maxCount: 1 },
  { name: 'excelFile', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('\n=== SUBMIT TAGGING REQUEST STARTED ===');
    
    // Initialize URLs
    let pdfUrl = null;
    let excelUrl = null;

    // 1. Extract all data from request
    const { 
      taggingId, 
      partyCode, 
      totalGrossWeight,
      totalNetWeight,
      totalStoneWeight,
      totalStoneCharges
    } = req.body;

    console.log('Request Data:', { 
      taggingId, 
      partyCode, 
      totalGrossWeight,
      totalNetWeight,
      totalStoneWeight,
      totalStoneCharges
    });

    // 2. Process PDF file
    if (req.files && req.files.pdfFile && req.files.pdfFile[0]) {
      console.log('\nProcessing PDF file...');
      const pdfFile = req.files.pdfFile[0];
      
      try {
        const contentVersion = await conn.sobject('ContentVersion').create({
          Title: `${taggingId}_PDF`,
          PathOnClient: pdfFile.originalname,
          VersionData: pdfFile.buffer.toString('base64'),
          IsMajorVersion: true
        });
        console.log('ContentVersion created:', contentVersion);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const distribution = await conn.sobject('ContentDistribution').create({
          Name: `${taggingId}_PDF`,
          ContentVersionId: contentVersion.id,
          PreferencesAllowViewInBrowser: true,
          PreferencesLinkLatestVersion: true,
          PreferencesNotifyOnVisit: false,
          PreferencesPasswordRequired: false,
          PreferencesExpires: false
        });
        console.log('ContentDistribution created:', distribution);

        const [distributionDetails] = await conn.sobject('ContentDistribution')
          .select('ContentDownloadUrl')
          .where({ Id: distribution.id })
          .execute();
        
        pdfUrl = distributionDetails.ContentDownloadUrl;
        console.log('PDF URL generated:', pdfUrl);
      } catch (pdfError) {
        console.error('Error processing PDF:', pdfError);
        throw new Error(`PDF processing failed: ${pdfError.message}`);
      }
    }

    // 3. Process Excel file
    if (req.files && req.files.excelFile && req.files.excelFile[0]) {
      console.log('\nProcessing Excel file...');
      const excelFile = req.files.excelFile[0];
      
      try {
        const contentVersion = await conn.sobject('ContentVersion').create({
          Title: `${taggingId}_Excel`,
          PathOnClient: excelFile.originalname,
          VersionData: excelFile.buffer.toString('base64'),
          IsMajorVersion: true
        });
        console.log('ContentVersion created:', contentVersion);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const distribution = await conn.sobject('ContentDistribution').create({
          Name: `${taggingId}_Excel`,
          ContentVersionId: contentVersion.id,
          PreferencesAllowViewInBrowser: true,
          PreferencesLinkLatestVersion: true,
          PreferencesNotifyOnVisit: false,
          PreferencesPasswordRequired: false,
          PreferencesExpires: false
        });
        console.log('ContentDistribution created:', distribution);

        const [distributionDetails] = await conn.sobject('ContentDistribution')
          .select('ContentDownloadUrl')
          .where({ Id: distribution.id })
          .execute();
        
        excelUrl = distributionDetails.ContentDownloadUrl;
        console.log('Excel URL generated:', excelUrl);
      } catch (excelError) {
        console.error('Error processing Excel:', excelError);
        throw new Error(`Excel processing failed: ${excelError.message}`);
      }
    }

    // 4. Create Tagging record with all weights
    console.log('\nCreating Tagging record with all details');
    const taggingRecord = await conn.sobject('Tagging__c').create({
      Name: taggingId,
      Party_Name__c: partyCode,
      Total_Gross_Weight__c: Number(totalGrossWeight),
      Total_Net_Weight__c: Number(totalNetWeight),
      Total_Stone_Weight__c: Number(totalStoneWeight),
      Total_Stone_Charges__c: Number(totalStoneCharges),
      Pdf__c: pdfUrl,
      Excel_sheet__c: excelUrl,
      Created_Date__c: new Date().toISOString()
    });

    console.log('Tagging record created:', taggingRecord);

    // 5. Update Tagged Items
    const taggedItems = await conn.sobject('Tagged_item__c')
      .find({ Tagging_ID__c: taggingId })
      .update({ 
        Tagging__c: taggingRecord.id 
      });

    console.log('Updated Tagged Items:', taggedItems);

    // 6. Send Response with all weights
    res.json({
      success: true,
      data: {
        id: taggingRecord.id,
        taggingId: taggingId,
        partyCode: partyCode,
        totalGrossWeight: totalGrossWeight,
        totalNetWeight: totalNetWeight,
        totalStoneWeight: totalStoneWeight,
        totalStoneCharges: totalStoneCharges,
        pdfUrl: pdfUrl,
        excelUrl: excelUrl,
        updatedItems: taggedItems.length
      }
    });

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to submit tagging",
      error: error.message,
      details: {
        files: req.files ? Object.keys(req.files) : [],
        body: req.body
      }
    });
  }
});



/**----------------- Get Tagging Details ----------------- */
app.get("/api/tagging-details/:taggingId", async (req, res) => {
  try {
    const { taggingId } = req.params;
    console.log('\n=== FETCHING TAGGING DETAILS ===');
    console.log('Tagging ID:', taggingId);

    // 1. Get Tagging record
    const taggingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Party_Name__c,
        Total_Gross_Weight__c,
        Total_Net_Weight__c,
        Total_Stone_Weight__c,
        Total_Stone_Charges__c,
        Pdf__c,
        Excel_sheet__c,
        Created_Date__c
       FROM Tagging__c 
       WHERE Name = '${taggingId}'`
    );

    if (!taggingQuery.records || taggingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tagging record not found"
      });
    }

    // 2. Get Tagged Items
    const taggedItemsQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        model_details__c,
        Model_Unique_Number__c,
        Gross_Weight__c,
        Net_Weight__c,
        Stone_Weight__c,
        Stone_Charge__c
       FROM Tagged_item__c 
       WHERE Tagging__c = '${taggingQuery.records[0].Id}'`
    );

    // 3. Prepare response
    const response = {
      success: true,
      data: {
        tagging: {
          id: taggingQuery.records[0].Id,
          taggingId: taggingQuery.records[0].Name,
          partyCode: taggingQuery.records[0].Party_Name__c,
          totalGrossWeight: taggingQuery.records[0].Total_Gross_Weight__c,
          totalNetWeight: taggingQuery.records[0].Total_Net_Weight__c,
          totalStoneWeight: taggingQuery.records[0].Total_Stone_Weight__c,
          totalStoneCharges: taggingQuery.records[0].Total_Stone_Charges__c,
          pdfUrl: taggingQuery.records[0].Pdf__c,
          excelUrl: taggingQuery.records[0].Excel_sheet__c,
          createdDate: taggingQuery.records[0].Created_Date__c
        },
        taggedItems: taggedItemsQuery.records.map(item => ({
          id: item.Id,
          name: item.Name,
          modelUniqueNumber: item.Model_Unique_Number__c,
          grossWeight: item.Gross_Weight__c,
          netWeight: item.Net_Weight__c,
          stoneWeight: item.Stone_Weight__c,
          stoneCharge: item.Stone_Charge__c,
          pdfUrl: item.model_details__c
        })),
        summary: {
          totalItems: taggedItemsQuery.records.length,
          totalGrossWeight: taggedItemsQuery.records.reduce((sum, item) => 
            sum + (item.Gross_Weight__c || 0), 0
          ),
          totalNetWeight: taggedItemsQuery.records.reduce((sum, item) => 
            sum + (item.Net_Weight__c || 0), 0
          ),
          totalStoneWeight: taggedItemsQuery.records.reduce((sum, item) => 
            sum + (item.Stone_Weight__c || 0), 0
          )
        }
      }
    };

    console.log('Sending response with:', {
      taggingFound: true,
      itemsCount: taggedItemsQuery.records.length,
      hasPDF: !!taggingQuery.records[0].Pdf__c,
      hasExcel: !!taggingQuery.records[0].Excel_sheet__c
    });

    res.json(response);

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tagging details",
      error: error.message
    });
  }
});

/**----------------- Get All Tagging Details ----------------- */
app.get("/api/tagging", async (req, res) => {
  try {
    console.log('\n=== FETCHING ALL TAGGING DETAILS ===');

    // Get all Tagging records
    const taggingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Party_Name__c,
        Total_Gross_Weight__c,
        Total_Net_Weight__c,
        Total_Stone_Weight__c,
        Total_Stone_Charges__c,
        Pdf__c,
        Excel_sheet__c,
        Created_Date__c
       FROM Tagging__c 
       ORDER BY Created_Date__c DESC`
    );

    if (!taggingQuery.records || taggingQuery.records.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Map the records to the desired format
    const taggings = taggingQuery.records.map(record => ({
      id: record.Id,
      taggingId: record.Name,
      partyCode: record.Party_Name__c,
      totalGrossWeight: record.Total_Gross_Weight__c,
      totalNetWeight: record.Total_Net_Weight__c,
      totalStoneWeight: record.Total_Stone_Weight__c,
      totalStoneCharges: record.Total_Stone_Charges__c,
      pdfUrl: record.Pdf__c,
      excelUrl: record.Excel_sheet__c,
      createdDate: record.Created_Date__c
    }));

    console.log(`Found ${taggings.length} tagging records`);

    res.json({
      success: true,
      data: taggings
    });

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tagging details",
      error: error.message
    });
  }
});

/**----------------- Get Party Ledger Details ----------------- */
app.get("/api/partyledger/:partyCode", async (req, res) => {
  try {
    const { partyCode } = req.params;
    console.log('\n=== FETCHING PARTY LEDGER DETAILS ===');
    console.log('Party Code:', partyCode);

    // Query Party_Ledger__c object
    const query = await conn.query(
      `SELECT 
        Id,
        Name,
        Party_Code__c,
        Address__c,
        Gst__c,
        Pan_Card__c
       FROM Party_Ledger__c 
       WHERE Party_Code__c = '${partyCode}'`
    );

    if (!query.records || query.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Party not found"
      });
    }

    const partyDetails = {
      id: query.records[0].Id,
      partyCode: query.records[0].Party_Code__c,
      partyName: query.records[0].Name,
      address: query.records[0].Address__c,
      gstNo: query.records[0].Gst__c,
      panNo: query.records[0].Pan_Card__c
    };

    console.log('Party details found:', partyDetails);

    res.json({
      success: true,
      data: partyDetails
    });

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch party details",
      error: error.message
    });
  }
});
/**----------------- Submit Billing ----------------- */
app.post("/api/billing/submit", upload.fields([
  { name: 'taxInvoicePdf', maxCount: 1 },
  { name: 'deliveryChallanPdf', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('\n=== SUBMIT BILLING REQUEST STARTED ===');
    
    // 1. Extract data from request
    const { 
      billingId, 
      taggingId, 
      partyName, 
      goldRate,
      invoiceNumber,
      invoiceDate,
      totalFineWeight
    } = req.body;

    console.log('Request Data:', { 
      billingId, 
      taggingId, 
      partyName, 
      goldRate,
      invoiceNumber,
      invoiceDate 
    });

    // 2. Initialize URLs
    let taxInvoiceUrl = null;
    let deliveryChallanUrl = null;

    // 3. Process Tax Invoice PDF
    if (req.files && req.files.taxInvoicePdf) {
      const pdfFile = req.files.taxInvoicePdf[0];
      
      const contentVersion = await conn.sobject('ContentVersion').create({
        Title: `${billingId}_TaxInvoice`,
        PathOnClient: pdfFile.originalname,
        VersionData: pdfFile.buffer.toString('base64'),
        IsMajorVersion: true
      });

      const distribution = await conn.sobject('ContentDistribution').create({
        Name: `${billingId}_TaxInvoice`,
        ContentVersionId: contentVersion.id,
        PreferencesAllowViewInBrowser: true,
        PreferencesLinkLatestVersion: true,
        PreferencesNotifyOnVisit: false,
        PreferencesPasswordRequired: false,
        PreferencesExpires: false
      });

      const [distributionDetails] = await conn.sobject('ContentDistribution')
        .select('ContentDownloadUrl')
        .where({ Id: distribution.id })
        .execute();
      
      taxInvoiceUrl = distributionDetails.ContentDownloadUrl;
    }

    // 4. Process Delivery Challan PDF
    if (req.files && req.files.deliveryChallanPdf) {
      const pdfFile = req.files.deliveryChallanPdf[0];
      
      const contentVersion = await conn.sobject('ContentVersion').create({
        Title: `${billingId}_DeliveryChallan`,
        PathOnClient: pdfFile.originalname,
        VersionData: pdfFile.buffer.toString('base64'),
        IsMajorVersion: true
      });

      const distribution = await conn.sobject('ContentDistribution').create({
        Name: `${billingId}_DeliveryChallan`,
        ContentVersionId: contentVersion.id,
        PreferencesAllowViewInBrowser: true,
        PreferencesLinkLatestVersion: true,
        PreferencesNotifyOnVisit: false,
        PreferencesPasswordRequired: false,
        PreferencesExpires: false
      });

      const [distributionDetails] = await conn.sobject('ContentDistribution')
        .select('ContentDownloadUrl')
        .where({ Id: distribution.id })
        .execute();
      
      deliveryChallanUrl = distributionDetails.ContentDownloadUrl;
    }

    // 5. Create Billing record
    const billingRecord = await conn.sobject('Billing__c').create({
      Name: billingId,
      Tagging_id__c: taggingId,
      Party_Name__c: partyName,
      Gold_Rate__c: Number(goldRate),
      Invoice_Number__c: invoiceNumber,
      Invoice_Date__c: invoiceDate,
      Tax_Invoice_URL__c: taxInvoiceUrl,
      Total_Net_Weight__c : Number(totalFineWeight),
      Delivery_Challan_URL__c: deliveryChallanUrl,
      Created_Date__c: new Date().toISOString()
    });

    console.log('Billing record created:', billingRecord);

    // 6. Send Response
    res.json({
      success: true,
      data: {
        id: billingRecord.id,
        billingId: billingId,
        taggingId: taggingId,
        partyName: partyName,
        goldRate: goldRate,
        totalFineWeight: totalFineWeight,
        invoiceNumber: invoiceNumber,
        invoiceDate: invoiceDate,
        taxInvoiceUrl: taxInvoiceUrl,
        deliveryChallanUrl: deliveryChallanUrl
      }
    });

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to submit billing",
      error: error.message,
      details: {
        files: req.files ? Object.keys(req.files) : [],
        body: req.body
      }
    });
  }
});

/**----------------- Get All Billing Details ----------------- */
app.get("/api/billing", async (req, res) => {
  try {
    console.log('\n=== FETCHING ALL BILLING DETAILS ===');

    // Query Billing__c records
    const billingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Party_Name__c,
        Created_Date__c,
        Total_Net_Weight__c,
        Delivery_Challan_URL__c,
        Tax_Invoice_URL__c
       FROM Billing__c 
       ORDER BY Created_Date__c DESC`
    );

    if (!billingQuery.records || billingQuery.records.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Map the records to the desired format
    const billings = billingQuery.records.map(record => ({
      id: record.Name,
      PartyName: record.Party_Name__c || '',
      createdDate: record.Created_Date__c || '',
      totalFineWeight: record.Total_Net_Weight__c || 0,
      DeliveryChallanUrl: record.Delivery_Challan_URL__c || '',
      TaxInvoiceUrl: record.Tax_Invoice_URL__c || ''
    }));

    console.log(`Found ${billings.length} billing records`);

    res.json({
      success: true,
      data: billings
    });

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch billing details",
      error: error.message
    });
  }
});



/**----------------- Get All Department Losses ----------------- */
app.get("/api/department-losses", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('\n=== FETCHING ALL DEPARTMENT LOSSES ===');
    console.log('Date Range:', { startDate, endDate });

    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Both startDate and endDate are required"
      });
    }

    // Format dates for SOQL query (exact Salesforce datetime format)
    const formatSalesforceDatetime = (dateStr, isEndDate = false) => {
      const date = new Date(dateStr);
      if (isEndDate) {
        // Set to end of day (23:59:59)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T23:59:59Z`;
      }
      // Start of day (00:00:00)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T00:00:00Z`;
    };

    // Format dates for display
    const formatDisplayDateTime = (dateStr) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    const formattedStartDate = formatSalesforceDatetime(startDate);
    const formattedEndDate = formatSalesforceDatetime(endDate, true);

    console.log('Formatted dates:', { formattedStartDate, formattedEndDate });

    // Query all departments with datetime comparison
    const [castingQuery, filingQuery, grindingQuery, settingQuery, polishingQuery] = await Promise.all([
      // Casting
      conn.query(
        `SELECT Id, Name, Issued_Date__c, Received_Date__c, Issud_weight__c, Weight_Received__c, Casting_Loss__c 
         FROM Casting_dept__c 
         WHERE Issued_Date__c >= ${formattedStartDate}
         AND Issued_Date__c <= ${formattedEndDate}
         AND Status__c = 'Finished'`
      ),
      // Filing
      conn.query(
        `SELECT Id, Name, Issued_Date__c, Received_Date__c, Issued_weight__c, Receievd_weight__c, Filing_loss__c 
         FROM Filing__c 
         WHERE Issued_Date__c >= ${formattedStartDate}
         AND Issued_Date__c <= ${formattedEndDate}
         AND Status__c = 'Finished'`
      ),
      // Grinding
      conn.query(
        `SELECT Id, Name, Issued_Date__c, Received_Date__c, Issued_Weight__c, Received_Weight__c, Grinding_loss__c 
         FROM Grinding__c 
         WHERE Issued_Date__c >= ${formattedStartDate}
         AND Issued_Date__c <= ${formattedEndDate}
         AND Status__c = 'Finished'`
      ),
      // Setting
      conn.query(
        `SELECT Id, Name, Issued_Date__c, Received_Date__c, Issued_Weight__c, Returned_weight__c, Setting_l__c 
         FROM Setting__c 
         WHERE Issued_Date__c >= ${formattedStartDate}
         AND Issued_Date__c <= ${formattedEndDate}
         AND Status__c = 'Finished'`
      ),
      // Polishing
      conn.query(
        `SELECT Id, Name, Issued_Date__c, Received_Date__c, Issued_Weight__c, Received_Weight__c, Polishing_loss__c 
         FROM Polishing__c 
         WHERE Issued_Date__c >= ${formattedStartDate}
         AND Issued_Date__c <= ${formattedEndDate}
         AND Status__c = 'Finished'`
      )
    ]);

    const response = {
      success: true,
      data: {
        casting: castingQuery.records.map(record => ({
          id: record.Name,
          issuedDate: formatDisplayDateTime(record.Issued_Date__c),
          receivedDate: formatDisplayDateTime(record.Received_Date__c),
          issuedWeight: record.Issud_weight__c || 0,
          receivedWeight: record.Weight_Received__c || 0,
          loss: record.Casting_Loss__c || 0
        })),
        filing: filingQuery.records.map(record => ({
          id: record.Name,
          issuedDate: formatDisplayDateTime(record.Issued_Date__c),
          receivedDate: formatDisplayDateTime(record.Received_Date__c),
          issuedWeight: record.Issued_weight__c || 0,
          receivedWeight: record.Receievd_weight__c || 0,
          loss: record.Filing_loss__c || 0
        })),
        grinding: grindingQuery.records.map(record => ({
          id: record.Name,
          issuedDate: formatDisplayDateTime(record.Issued_Date__c),
          receivedDate: formatDisplayDateTime(record.Received_Date__c),
          issuedWeight: record.Issued_Weight__c || 0,
          receivedWeight: record.Received_Weight__c || 0,
          loss: record.Grinding_loss__c || 0
        })),
        setting: settingQuery.records.map(record => ({
          id: record.Name,
          issuedDate: formatDisplayDateTime(record.Issued_Date__c),
          receivedDate: formatDisplayDateTime(record.Received_Date__c),
          issuedWeight: record.Issued_Weight__c || 0,
          receivedWeight: record.Returned_weight__c || 0,
          loss: record.Setting_l__c || 0
        })),
        polishing: polishingQuery.records.map(record => ({
          id: record.Name,
          issuedDate: formatDisplayDateTime(record.Issued_Date__c),
          receivedDate: formatDisplayDateTime(record.Received_Date__c),
          issuedWeight: record.Issued_Weight__c || 0,
          receivedWeight: record.Received_Weight__c || 0,
          loss: record.Polishing_loss__c || 0
        }))
      },
      summary: {
        totalCastingLoss: castingQuery.records.reduce((sum, record) => sum + (record.Casting_Loss__c || 0), 0),
        totalFilingLoss: filingQuery.records.reduce((sum, record) => sum + (record.Filing_loss__c || 0), 0),
        totalGrindingLoss: grindingQuery.records.reduce((sum, record) => sum + (record.Grinding_loss__c || 0), 0),
        totalSettingLoss: settingQuery.records.reduce((sum, record) => sum + (record.Setting_l__c || 0), 0),
        totalPolishingLoss: polishingQuery.records.reduce((sum, record) => sum + (record.Polishing_loss__c || 0), 0),
        totalOverallLoss: 
          castingQuery.records.reduce((sum, record) => sum + (record.Casting_Loss__c || 0), 0) +
          filingQuery.records.reduce((sum, record) => sum + (record.Filing_loss__c || 0), 0) +
          grindingQuery.records.reduce((sum, record) => sum + (record.Grinding_loss__c || 0), 0) +
          settingQuery.records.reduce((sum, record) => sum + (record.Setting_l__c || 0), 0) +
          polishingQuery.records.reduce((sum, record) => sum + (record.Polishing_loss__c || 0), 0)
      }
    };

    console.log('Response Summary:', response.summary);
    res.json(response);

  } catch (error) {
    console.error('\n=== ERROR DETAILS ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch department losses",
      error: error.message
    });
  }
});

/**----------------- Get Pouches for Grinding by Date ----------------- */
app.get("/api/grinding/pouches/:date/:month/:year/:number", async (req, res) => {
  try {
    const { date, month, year, number } = req.params;
    
    console.log('[Get Grinding Pouches] Received params:', { date, month, year, number });

    // Ensure consistent formatting with padded zeros
    const paddedDate = String(date).padStart(2, '0');
    const paddedMonth = String(month).padStart(2, '0');
    const paddedNumber = String(number).padStart(2, '0');
    const grindingId = `${paddedDate}/${paddedMonth}/${year}/${paddedNumber}`;
    
    console.log('[Get Grinding Pouches] Formatted grinding ID:', grindingId);

    // Debug query to see what records exist
    const debugQuery = await conn.query(
      `SELECT Id, Name 
       FROM Grinding__c 
       WHERE Name LIKE '%${paddedMonth}/${year}/${paddedNumber}'`
    );
    console.log('[Get Grinding Pouches] Available grinding records:', debugQuery.records);

    // Get the specific grinding record
    const grindingQuery = await conn.query(
      `SELECT Id, Name 
       FROM Grinding__c 
       WHERE Name = '${grindingId}'`
    );
    console.log('[Get Grinding Pouches] Exact match result:', grindingQuery.records);

    if (!grindingQuery.records || grindingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grinding record not found",
        debug: {
          searchedId: grindingId,
          availableRecords: debugQuery.records.map(r => r.Name)
        }
      });
    }

    const grindingRecord = grindingQuery.records[0];
    console.log('[Get Grinding Pouches] Found grinding record:', grindingRecord);

    // Get associated pouches
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Order_Id__c,
        Isssued_Weight_Grinding__c,
        Received_Weight_Grinding__c
       FROM Pouch__c 
       WHERE Grinding__c = '${grindingRecord.Id}'`
    );
    console.log('[Get Grinding Pouches] Found pouches count:', pouchesQuery.records.length);

    // Get related order details
    const orderIds = [...new Set(pouchesQuery.records
      .map(pouch => pouch.Order_Id__c)
      .filter(id => id))];

    let orderDetails = [];
    if (orderIds.length > 0) {
      const orderQuery = await conn.query(
        `SELECT Id, Order_Id__c, Party_Name__c
         FROM Order__c 
         WHERE Order_Id__c IN ('${orderIds.join("','")}')`
      );
      orderDetails = orderQuery.records;
    }

    // Combine pouch and order information
    const pouchesWithDetails = pouchesQuery.records.map(pouch => {
      const relatedOrder = orderDetails.find(order => order.Order_Id__c === pouch.Order_Id__c);
      return {
        ...pouch,
        partyName: relatedOrder ? relatedOrder.Party_Name__c : null,
        orderNumber: pouch.Order_Id__c
      };
    });

    res.json({
      success: true,
      data: {
        grindingId: grindingId,
        pouches: pouchesWithDetails
      },
      summary: {
        totalPouches: pouchesWithDetails.length,
        totalWeight: pouchesWithDetails.reduce((sum, pouch) => 
          sum + (pouch.Isssued_Weight_Grinding__c || 0), 0)
      }
    });

  } catch (error) {
    console.error("[Get Grinding Pouches] Error:", error);
    console.error("[Get Grinding Pouches] Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pouches for grinding",
      error: error.message
    });
  }
});


app.post("/api/grinding-record/create", async (req, res) => {
  try {
    const { 
      grindingId,  
      issuedWeight, 
      issuedDate, 
      pouches,
      orderId,
      quantity,
      name
        
    } = req.body;

    console.log('Creating Grinding record:', { 
      grindingId,  
      issuedWeight, 
      issuedDate 
    });

    // First create the Grinding record
    const grindingResult = await conn.sobject('Grinding__c').create({
      Name: grindingId,
      Issued_Weight__c: issuedWeight,
      Issued_Date__c: issuedDate,
      Status__c: 'In progress',
      Product__C : name,
      Order_Id__c: orderId,
      Quantity__c : quantity

    });

    console.log('Grinding creation result:', grindingResult);

    if (!grindingResult.success) {
      throw new Error('Failed to create grinding record');
    }

    // Create WIP pouches
    const pouchRecords = pouches.map(pouch => ({
      Name: pouch.pouchId,
      Grinding__c: grindingResult.id,
      Order_Id__c: pouch.orderId,
      Isssued_Weight_Grinding__c: pouch.weight,
      Product__c : pouch.name,
      Quantity__c: pouch.quantity
    }));

    console.log('Creating pouches:', pouchRecords);

    const pouchResults = await conn.sobject('Pouch__c').create(pouchRecords);
    console.log('Pouch creation results:', pouchResults);

    // Add this section to create pouch items with clear logging
    if (Array.isArray(pouchResults)) {
      console.log('Starting pouch items creation...');
      
      const pouchItemPromises = pouchResults.map(async (pouchResult, index) => {
        console.log(`Processing pouch ${index + 1}:`, pouchResult);
        
        if (pouches[index].categories && pouches[index].categories.length > 0) {
          console.log(`Found ${pouches[index].categories.length} categories for pouch ${index + 1}`);
          
          const pouchItemRecords = pouches[index].categories.map(category => {
            const itemRecord = {
              Name: category.category,
              WIPPouch__c: pouchResult.id,
              Category__c: category.category,
              Quantity__c: category.quantity
            };
            console.log('Creating pouch item:', itemRecord);
            return itemRecord;
          });

          try {
            console.log(`Attempting to create ${pouchItemRecords.length} pouch items`);
            const itemResults = await conn.sobject('Pouch_Items__c').create(pouchItemRecords);
            
            if (Array.isArray(itemResults)) {
              itemResults.forEach((result, i) => {
                if (result.success) {
                  console.log(`Pouch item ${i + 1} created successfully:`, result);
                } else {
                  console.error(`Pouch item ${i + 1} creation failed:`, result.errors);
                }
              });
            } else {
              if (itemResults.success) {
                console.log('Single pouch item created successfully:', itemResults);
              } else {
                console.error('Single pouch item creation failed:', itemResults.errors);
              }
            }
            
            return itemResults;
          } catch (error) {
            console.error('Error in pouch items creation:', error.message);
            console.error('Full error:', error);
            throw error;
          }
        } else {
          console.log(`No categories found for pouch ${index + 1}`);
        }
      });

      console.log('Waiting for all pouch items to be created...');
      const pouchItemResults = await Promise.all(pouchItemPromises);
      console.log('All pouch items creation completed:', pouchItemResults);
    }

    res.json({
      success: true,
      message: "Grinding record created successfully",
      data: {
        grindingId,
        grindingRecordId: grindingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("Error creating grinding record:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create grinding record"
    });
  }
});


app.post("/api/setting-record/create", async (req, res) => {
  try {
    const { 
      settingId,  
      issuedWeight, 
      issuedDate, 
      pouches,
      orderId,
      quantity,
      name  
    } = req.body;

    console.log('Creating Setting record:', { 
      settingId,  
      issuedWeight, 
      issuedDate 
    });

    // First create the Setting record
    const settingResult = await conn.sobject('Setting__c').create({
      Name: settingId,
      Issued_Weight__c: issuedWeight,
      Issued_Date__c: issuedDate,
      Status__c: 'In progress',
      Product__C : name,
      Order_Id__c: orderId,
      Quantity__c : quantity
    });

    console.log('Setting creation result:', settingResult);

    if (!settingResult.success) {
      throw new Error('Failed to create setting record');
    }

    // Create WIP pouches
    const pouchRecords = pouches.map(pouch => ({
      Name: pouch.pouchId,
      Setting__c: settingResult.id,
      Order_Id__c: pouch.orderId,
      Issued_Weight_Setting__c: pouch.weight,
      Product__c : pouch.name,
      Quantity__c: pouch.quantity
    }));

    console.log('Creating pouches:', pouchRecords);

    const pouchResults = await conn.sobject('Pouch__c').create(pouchRecords);
    console.log('Pouch creation results:', pouchResults);

    // Add this section to create pouch items with clear logging
    if (Array.isArray(pouchResults)) {
      console.log('Starting pouch items creation...');
      
      const pouchItemPromises = pouchResults.map(async (pouchResult, index) => {
        console.log(`Processing pouch ${index + 1}:`, pouchResult);
        
        if (pouches[index].categories && pouches[index].categories.length > 0) {
          console.log(`Found ${pouches[index].categories.length} categories for pouch ${index + 1}`);
          
          const pouchItemRecords = pouches[index].categories.map(category => {
            const itemRecord = {
              Name: category.category,
              WIPPouch__c: pouchResult.id,
              Category__c: category.category,
              Quantity__c: category.quantity
            };
            console.log('Creating pouch item:', itemRecord);
            return itemRecord;
          });

          try {
            console.log(`Attempting to create ${pouchItemRecords.length} pouch items`);
            const itemResults = await conn.sobject('Pouch_Items__c').create(pouchItemRecords);
            
            if (Array.isArray(itemResults)) {
              itemResults.forEach((result, i) => {
                if (result.success) {
                  console.log(`Pouch item ${i + 1} created successfully:`, result);
                } else {
                  console.error(`Pouch item ${i + 1} creation failed:`, result.errors);
                }
              });
            } else {
              if (itemResults.success) {
                console.log('Single pouch item created successfully:', itemResults);
              } else {
                console.error('Single pouch item creation failed:', itemResults.errors);
              }
            }
            
            return itemResults;
          } catch (error) {
            console.error('Error in pouch items creation:', error.message);
            console.error('Full error:', error);
            throw error;
          }
        } else {
          console.log(`No categories found for pouch ${index + 1}`);
        }
      });

      console.log('Waiting for all pouch items to be created...');
      const pouchItemResults = await Promise.all(pouchItemPromises);
      console.log('All pouch items creation completed:', pouchItemResults);
    }

    res.json({
      success: true,
      message: "Setting record created successfully",
      data: {
        settingId,
        settingRecordId: settingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("Error creating setting record:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create setting record"
    });
  }
});


app.post("/api/polishing-record/create", async (req, res) => {
  try {
    const { 
      polishingId,  
      issuedWeight, 
      issuedDate, 
      pouches,
      orderId,
      quantity,
      name    
    } = req.body;

    console.log('Creating Polishing record:', { 
      polishingId,  
      issuedWeight, 
      issuedDate 
    });

    // First create the Polishing record
    const polishingResult = await conn.sobject('Polishing__c').create({
      Name: polishingId,
      Issued_Weight__c: issuedWeight,
      Issued_Date__c: issuedDate,
      Status__c: 'In progress',
      Product__C : name,
      Order_Id__c: orderId,
      Quantity__c : quantity
    });

    console.log('Polishing creation result:', polishingResult);

    if (!polishingResult.success) {
      throw new Error('Failed to create polishing record');
    }

    // Create WIP pouches
    const pouchRecords = pouches.map(pouch => ({
      Name: pouch.pouchId,
      Polishing__c: polishingResult.id,
      Order_Id__c: pouch.orderId,
      Issued_Weight_Polishing__c: pouch.weight,
      Product__c : pouch.name,
      Quantity__c: pouch.quantity
    }));

    console.log('Creating pouches:', pouchRecords);

    const pouchResults = await conn.sobject('Pouch__c').create(pouchRecords);
    console.log('Pouch creation results:', pouchResults);

    // Add this section to create pouch items with clear logging
    if (Array.isArray(pouchResults)) {
      console.log('Starting pouch items creation...');
      
      const pouchItemPromises = pouchResults.map(async (pouchResult, index) => {
        console.log(`Processing pouch ${index + 1}:`, pouchResult);
        
        if (pouches[index].categories && pouches[index].categories.length > 0) {
          console.log(`Found ${pouches[index].categories.length} categories for pouch ${index + 1}`);
          
          const pouchItemRecords = pouches[index].categories.map(category => {
            const itemRecord = {
              Name: category.category,
              WIPPouch__c: pouchResult.id,
              Category__c: category.category,
              Quantity__c: category.quantity
            };
            console.log('Creating pouch item:', itemRecord);
            return itemRecord;
          });

          try {
            console.log(`Attempting to create ${pouchItemRecords.length} pouch items`);
            const itemResults = await conn.sobject('Pouch_Items__c').create(pouchItemRecords);
            
            if (Array.isArray(itemResults)) {
              itemResults.forEach((result, i) => {
                if (result.success) {
                  console.log(`Pouch item ${i + 1} created successfully:`, result);
                } else {
                  console.error(`Pouch item ${i + 1} creation failed:`, result.errors);
                }
              });
            } else {
              if (itemResults.success) {
                console.log('Single pouch item created successfully:', itemResults);
              } else {
                console.error('Single pouch item creation failed:', itemResults.errors);
              }
            }
            
            return itemResults;
          } catch (error) {
            console.error('Error in pouch items creation:', error.message);
            console.error('Full error:', error);
            throw error;
          }
        } else {
          console.log(`No categories found for pouch ${index + 1}`);
        }
      });

      console.log('Waiting for all pouch items to be created...');
      const pouchItemResults = await Promise.all(pouchItemPromises);
      console.log('All pouch items creation completed:', pouchItemResults);
    }

    res.json({
      success: true,
      message: "Polishing record created successfully",
      data: {
        polishingId,
        polishingRecordId: polishingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("Error creating polishing record:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create polishing record"
    });
  }
});

/**----------------- Create Plating Record ----------------- */
app.post("/api/plating/create", async (req, res) => {
  try {
    const { 
      platingId,  // This will be the formatted ID from frontend (e.g., 'PLAT/19/04/2025/01')
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    // Create the Plating record with the provided platingId as Name
    const platingResult = await conn.sobject('Plating__c').create({
      Name: platingId,  // Using the platingId directly as Name
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__c : product,
      Quantity__c: quantity,
      Order_Id__c :orderId
    });

    console.log('[Plating Create] Plating record created:', platingResult);

    if (!platingResult.success) {
      throw new Error('Failed to create plating record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Plating Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.platingWeight,
        platingId: platingId  // Log the formatted ID
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Plating__c: platingId,        // Salesforce ID for relationship        // Store the formatted plating ID (e.g., PLAT/19/04/2025/01)
        Issued_Weight_Plating__c: pouch.platingWeight,
        Product__c : pouch.product,
        Quantity__c : pouch.quantity
      });

      console.log('[Plating Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Plating record created successfully",
      data: {
        platingId: platingId,
        platingRecordId: platingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("[Plating Create] Error:", error);
    console.error("[Plating Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create plating record"
    });
  }
});

/**----------------- Create Cutting Record ----------------- */
app.post("/api/cutting/create", async (req, res) => {
  try {
    const { 
      cuttingId,
      issuedDate,
      pouches,
      totalWeight,
      status,
      product,
      quantity,
      orderId
    } = req.body;

    console.log('[Cutting Create] Received data:', { 
      cuttingId,
      issuedDate,
      pouchCount: pouches.length,
      totalWeight,
      status
    });

    // Create the Cutting record
    const cuttingResult = await conn.sobject('Cutting__c').create({
      Name: cuttingId,
      Issued_Date__c: issuedDate,
      Issued_Weight__c: totalWeight,
      Status__c: status,
      Product__c: product,
      Quantity__c : quantity,
      Order_Id__c : orderId
    });

    console.log('[Cutting Create] Cutting record created:', cuttingResult);

    if (!cuttingResult.success) {
      throw new Error('Failed to create cutting record');
    }

    // Update existing pouches
    const pouchResults = await Promise.all(pouches.map(async pouch => {
      console.log('[Cutting Create] Updating pouch:', {
        pouchId: pouch.pouchId,
        weight: pouch.cuttingWeight
      });

      const pouchResult = await conn.sobject('Pouch__c').update({
        Id: pouch.pouchId,
        Cutting__c: cuttingId,          // Store the formatted cutting ID
        Issued_Weight_Cutting__c: pouch.cuttingWeight,
        Product__c : pouch.product,
        Quantity__c : pouch.quantity
      });

      
      console.log('[Cutting Create] Pouch updated:', pouchResult);
      return pouchResult;
    }));

    res.json({
      success: true,
      message: "Cutting record created successfully",
      data: {
        cuttingId: cuttingId,
        cuttingRecordId: cuttingResult.id,
        pouches: pouchResults
      }
    });

  } catch (error) {
    console.error("[Cutting Create] Error:", error);
    console.error("[Cutting Create] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create cutting record"
    });
  }
});

/**----------------- Update Plating Received Weight ----------------- */
app.post("/api/plating/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const { receivedDate, receivedWeight, platingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const platingNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log('[Plating Update] Received data:', { 
      platingNumber, 
      receivedDate, 
      receivedWeight, 
      platingLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches 
    });

    // First get the Plating record
    const platingQuery = await conn.query(
      `SELECT Id, Name FROM Plating__c WHERE Name = '${platingNumber}'`
    );

    if (!platingQuery.records || platingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Plating record not found"
      });
    }

    const plating = platingQuery.records[0];

    // Update the plating record
    const updateData = {
      Id: plating.Id,
      Received_Date__c: receivedDate,
      Returned_Weight__c: receivedWeight,
      Plating_Loss__c: platingLoss,
      Plating_Scrap_Weight__c: scrapReceivedWeight,
      Plating_Dust_Weight__c: dustReceivedWeight,
      Plating_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Plating__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update plating record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Plating__c: pouch.receivedWeight,
            Plating_Loss__c: platingLoss
          });

          console.log(`[Plating Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Plating Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '${plating.Purity__c || '91.7%'}'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: plating.Purity__c || '91.7%',
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Dust' 
       AND Purity__c = '${plating.Purity__c || '91.7%'}'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Dust',
          Item_Name__c: 'Dust',
          Purity__c: plating.Purity__c || '91.7%',
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Plating record updated successfully",
      data: {
        platingNumber,
        receivedDate,
        receivedWeight,
        platingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Plating Update] Error:", error);
    console.error("[Plating Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update plating record"
    });
  }
});

/**----------------- Update Cutting Received Weight ----------------- */


app.post("/api/cutting/update/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const { receivedDate, receivedWeight, cuttingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const cuttingNumber = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;

    console.log('[Cutting Update] Received data:', { 
      cuttingNumber, 
      receivedDate, 
      receivedWeight, 
      cuttingLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches 
    });

    // First get the Cutting record
    const cuttingQuery = await conn.query(
      `SELECT Id, Name FROM Cutting__c WHERE Name = '${cuttingNumber}'`
    );

    if (!cuttingQuery.records || cuttingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cutting record not found"
      });
    }

    const cutting = cuttingQuery.records[0];

    // Update the cutting record
    const updateData = {
      Id: cutting.Id,
      Received_Date__c: receivedDate,
      Returned_Weight__c: receivedWeight,
      Cutting_Loss__c: cuttingLoss,
      Cutting_Scrap_Weight__c: scrapReceivedWeight,
      Cutting_Dust_Weight__c: dustReceivedWeight,
      Cutting_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Cutting__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update cutting record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Cutting__c: pouch.receivedWeight,
            Cutting_Loss__c: cuttingLoss
          });

          console.log(`[Cutting Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Cutting Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '${cutting.Purity__c || '91.7%'}'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: cutting.Purity__c || '91.7%',
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Cutting Dust' 
       AND Purity__c = '${cutting.Purity__c || '91.7%'}'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Cutting Dust',
          Item_Name__c: 'Cutting Dust',
          Purity__c: cutting.Purity__c || '91.7%',
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Cutting record updated successfully",
      data: {
        cuttingNumber,
        receivedDate,
        receivedWeight,
        cuttingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Cutting Update] Error:", error);
    console.error("[Cutting Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update cutting record"
    });
  }
});

app.post("/api/cutting/update/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const { receivedDate, receivedWeight, cuttingLoss, scrapReceivedWeight, dustReceivedWeight, ornamentWeight, pouches } = req.body;
    const cuttingNumber = `${prefix}/${date}/${month}/${year}/${number}`;

    console.log('[Cutting Update] Received data:', { 
      cuttingNumber, 
      receivedDate, 
      receivedWeight, 
      cuttingLoss,
      scrapReceivedWeight,
      dustReceivedWeight,
      ornamentWeight,
      pouches 
    });

    // First get the Cutting record
    const cuttingQuery = await conn.query(
      `SELECT Id, Name FROM Cutting__c WHERE Name = '${cuttingNumber}'`
    );

    if (!cuttingQuery.records || cuttingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cutting record not found"
      });
    }

    const cutting = cuttingQuery.records[0];

    // Update the cutting record
    const updateData = {
      Id: cutting.Id,
      Received_Date__c: receivedDate,
      Returned_Weight__c: receivedWeight,
      Cutting_Loss__c: cuttingLoss,
      Cutting_Scrap_Weight__c: scrapReceivedWeight,
      Cutting_Dust_Weight__c: dustReceivedWeight,
      Cutting_Ornament_Weight__c: ornamentWeight,
      Status__c: 'Finished'
    };

    const updateResult = await conn.sobject('Cutting__c').update(updateData);

    if (!updateResult.success) {
      throw new Error('Failed to update cutting record');
    }

    // Update pouches if provided
    if (pouches && pouches.length > 0) {
      for (const pouch of pouches) {
        try {
          const pouchUpdateResult = await conn.sobject('Pouch__c').update({
            Id: pouch.pouchId,
            Received_Weight_Cutting__c: pouch.receivedWeight,
            Cutting_Loss__c: cuttingLoss
          });

          console.log(`[Cutting Update] Pouch update result for ${pouch.pouchId}:`, pouchUpdateResult);
        } catch (pouchError) {
          console.error(`[Cutting Update] Failed to update pouch ${pouch.pouchId}:`, pouchError);
          throw pouchError;
        }
      }
    }

    // Check if scrap inventory exists for this purity
    const scrapInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Scrap' 
       AND Purity__c = '${cutting.Purity__c || '91.7%'}'`
    );

    if (scrapReceivedWeight > 0) {
      if (scrapInventoryQuery.records.length > 0) {
        // Update existing scrap inventory
        const currentWeight = scrapInventoryQuery.records[0].Available_weight__c || 0;
        const scrapUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: scrapInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + scrapReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!scrapUpdateResult.success) {
          throw new Error('Failed to update scrap inventory');
        }
      } else {
        // Create new scrap inventory
        const scrapCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Scrap',
          Item_Name__c: 'Scrap',
          Purity__c: cutting.Purity__c || '91.7%',
          Available_weight__c: scrapReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!scrapCreateResult.success) {
          throw new Error('Failed to create scrap inventory');
        }
      }
    }

    // Check if dust inventory exists
    const dustInventoryQuery = await conn.query(
      `SELECT Id, Available_weight__c FROM Inventory_ledger__c 
       WHERE Item_Name__c = 'Cutting Dust' 
       AND Purity__c = '${cutting.Purity__c || '91.7%'}'`
    );

    if (dustReceivedWeight > 0) {
      if (dustInventoryQuery.records.length > 0) {
        // Update existing dust inventory
        const currentWeight = dustInventoryQuery.records[0].Available_weight__c || 0;
        const dustUpdateResult = await conn.sobject('Inventory_ledger__c').update({
          Id: dustInventoryQuery.records[0].Id,
          Available_weight__c: currentWeight + dustReceivedWeight,
          Last_Updated__c: receivedDate
        });

        if (!dustUpdateResult.success) {
          throw new Error('Failed to update dust inventory');
        }
      } else {
        // Create new dust inventory
        const dustCreateResult = await conn.sobject('Inventory_ledger__c').create({
          Name: 'Cutting Dust',
          Item_Name__c: 'Cutting Dust',
          Purity__c: cutting.Purity__c || '91.7%',
          Available_weight__c: dustReceivedWeight,
          Unit_of_Measure__c: 'Grams',
          Last_Updated__c: receivedDate
        });

        if (!dustCreateResult.success) {
          throw new Error('Failed to create dust inventory');
        }
      }
    }

    res.json({
      success: true,
      message: "Cutting record updated successfully",
      data: {
        cuttingNumber,
        receivedDate,
        receivedWeight,
        cuttingLoss,
        scrapReceivedWeight,
        dustReceivedWeight,
        ornamentWeight,
        status: 'Finished'
      }
    });

  } catch (error) {
    console.error("[Cutting Update] Error:", error);
    console.error("[Cutting Update] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update cutting record"
    });
  }
});


/**----------------- Get All Plating Records ----------------- */
app.get("/api/plating", async (req, res) => {
  try {
    console.log('[Get Plating] Fetching all plating records');

    const platingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Product__c,
        Order_Id__c,
        Quantity__c,
        Plating_loss__c,
        CreatedDate,Plating_Scrap_Weight__c,Plating_Dust_Weight__c
       FROM Plating__c
       ORDER BY CreatedDate DESC`
    );

    console.log('[Get Plating] Found plating records:', platingQuery.records.length);

    res.json({
      success: true,
      data: platingQuery.records
    });

  } catch (error) {
    console.error("[Get Plating] Error:", error);
    console.error("[Get Plating] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch plating records"
    });
  }
});

/**----------------- Get All Cutting Records ----------------- */
app.get("/api/cutting", async (req, res) => {
  try {
    console.log('[Get Cutting] Fetching all cutting records');

    const cuttingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Product__c,
        Quantity__c,
        Order_Id__c,
        Cutting_loss__c,
        CreatedDate,Cutting_Scrap_Weight__c ,Cutting_Ornament_Weight__c
       FROM Cutting__c
       ORDER BY CreatedDate DESC`
    );

    console.log('[Get Cutting] Found cutting records:', cuttingQuery.records.length);

    res.json({
      success: true,
      data: cuttingQuery.records
    });

  } catch (error) {
    console.error("[Get Cutting] Error:", error);
    console.error("[Get Cutting] Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch cutting records"
    });
  }
});

/**----------------- Get Plating Details ----------------- */
app.get("/api/plating-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const platingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Plating details
    const platingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Plating_loss__c
       FROM Plating__c
       WHERE Name = '${platingId}'`
    );

    if (!platingQuery.records || platingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Plating record not found"
      });
    }

    const plating = platingQuery.records[0];

    // 2. Get Pouches for this plating
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Weight_Plating__c,
        Received_Weight_Plating__c
       FROM Pouch__c 
       WHERE Plating__c = '${platingId}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        plating: plating,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_Weight_Plating__c || 0), 0),
        issuedWeight: plating.Issued_Weight__c,
        receivedWeight: plating.Returned_weight__c,
        platingLoss: plating.Plating_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching plating details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch plating details"
    });
  }
});

/**----------------- Get Cutting Details ----------------- */
app.get("/api/cutting-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const cuttingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Cutting details
    const cuttingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Cutting_loss__c
       FROM Cutting__c
       WHERE Name = '${cuttingId}'`
    );

    if (!cuttingQuery.records || cuttingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cutting record not found"
      });
    }

    const cutting = cuttingQuery.records[0];

    // 2. Get Pouches for this cutting
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Weight_Cutting__c,
        Received_Weight_Cutting__c
       FROM Pouch__c 
       WHERE Cutting__c = '${cuttingId}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        cutting: cutting,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_Weight_Cutting__c || 0), 0),
        issuedWeight: cutting.Issued_Weight__c,
        receivedWeight: cutting.Returned_weight__c,
        cuttingLoss: cutting.Cutting_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching cutting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch cutting details"
    });
  }
});

/**----------------- Get Pouches for Plating ----------------- */
app.get("/api/plating/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const platingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Plating Pouches] Fetching details for plating:', platingId);

    // First get the Plating record with all fields
    const platingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Plating_loss__c
       FROM Plating__c 
       WHERE Name = '${platingId}'`
    );

    if (!platingQuery.records || platingQuery.records.length === 0) {
      console.log('[Get Plating Pouches] Plating not found:', platingId);
      return res.status(404).json({
        success: false,
        message: "Plating record not found"
      });
    }

    // Get pouches with their IDs and weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_Weight_Plating__c,
        Received_Weight_Plating__c,
        Quantity__c,
        Product__c,
        Order_Id__c
       FROM Pouch__c 
       WHERE Plating__c = '${platingId}'`
    );

    console.log('[Get Plating Pouches] Found pouches:', pouchesQuery.records);
    console.log('[Get Plating Pouches] Plating details:', platingQuery.records[0]);

    res.json({
      success: true,
      data: {
        plating: platingQuery.records[0],
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Plating Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch plating details"
    });
  }
});

app.get("/api/cutting-details/:prefix/:date/:month/:year/:number", async (req, res) => {
  try {
    const { prefix, date, month, year, number } = req.params;
    const cuttingId = `${prefix}/${date}/${month}/${year}/${number}`;

    // 1. Get Cutting details
    const cuttingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Cutting_loss__c
       FROM Cutting__c
       WHERE Name = '${cuttingId}'`
    );

    if (!cuttingQuery.records || cuttingQuery.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cutting record not found"
      });
    }

    const cutting = cuttingQuery.records[0];

    // 2. Get Pouches for this cutting
    const pouchesQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Order_Id__c,
        Issued_Weight_Cutting__c,
        Received_Weight_Cutting__c
       FROM Pouch__c 
       WHERE Cutting__c = '${cuttingId}'`
    );

    // 3. Get Orders for these pouches
    const orderIds = pouchesQuery.records.map(pouch => `'${pouch.Order_Id__c}'`).join(',');
    let orders = [];
    let models = [];

    if (orderIds.length > 0) {
      const ordersQuery = await conn.query(
        `SELECT 
          Id,
          Name,
          Order_Id__c,
          Party_Name__c,
          Delivery_Date__c,
          Status__c
         FROM Order__c 
         WHERE Order_Id__c IN (${orderIds})`
      );
      
      orders = ordersQuery.records;

      // 4. Get Models for these orders
      const orderIdsForModels = orders.map(order => `'${order.Id}'`).join(',');
      if (orderIdsForModels.length > 0) {
        const modelsQuery = await conn.query(
          `SELECT 
            Id,
            Name,
            Order__c,
            Category__c,
            Purity__c,
            Size__c,
            Color__c,
            Quantity__c,
            Gross_Weight__c,
            Stone_Weight__c,
            Net_Weight__c
           FROM Order_Models__c 
           WHERE Order__c IN (${orderIdsForModels})`
        );
        
        models = modelsQuery.records;
      }
    }

    const response = {
      success: true,
      data: {
        cutting: cutting,
        pouches: pouchesQuery.records.map(pouch => {
          const relatedOrder = orders.find(order => order.Order_Id__c === pouch.Order_Id__c);
          const pouchModels = relatedOrder ? models.filter(model => 
            model.Order__c === relatedOrder.Id
          ) : [];

          return {
            ...pouch,
            order: relatedOrder || null,
            models: pouchModels
          };
        })
      },
      summary: {
        totalPouches: pouchesQuery.records.length,
        totalOrders: orders.length,
        totalModels: models.length,
        totalPouchWeight: pouchesQuery.records.reduce((sum, pouch) => 
              sum + (pouch.Issued_Weight_Cutting__c || 0), 0),
        issuedWeight: cutting.Issued_Weight__c,
        receivedWeight: cutting.Returned_weight__c,
        cuttingLoss: cutting.Cutting_loss__c
      }
    };

    res.json(response);

  } catch (error) {
    console.error("Error fetching cutting details:", error);
    console.error("Full error details:", JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch cutting details"
    });
  }
});

/**----------------- Get Pouches for Plating ----------------- */
app.get("/api/plating/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number,subnumber } = req.params;
    const platingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Plating Pouches] Fetching details for plating:', platingId);

    // First get the Plating record with all fields
    const platingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Plating_loss__c
       FROM Plating__c 
       WHERE Name = '${platingId}'`
    );

    if (!platingQuery.records || platingQuery.records.length === 0) {
      console.log('[Get Plating Pouches] Plating not found:', platingId);
      return res.status(404).json({
        success: false,
        message: "Plating record not found"
      });
    }

    // Get pouches with their IDs and weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_Weight_Plating__c,
        Received_Weight_Plating__c,
        Quantity__c,
        Product__c,
        Order_Id__c
       FROM Pouch__c 
       WHERE Plating__c = '${platingId}'`
    );

    console.log('[Get Plating Pouches] Found pouches:', pouchesQuery.records);
    console.log('[Get Plating Pouches] Plating details:', platingQuery.records[0]);

    res.json({
      success: true,
      data: {
        plating: platingQuery.records[0],
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Plating Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch plating details"
    });
  }
});

/**----------------- Get Pouches for Cutting ----------------- */






app.get("/api/cutting/:prefix/:date/:month/:year/:number/:subnumber/pouches", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
    const cuttingId = `${prefix}/${date}/${month}/${year}/${number}/${subnumber}`;
    
    console.log('[Get Cutting Pouches] Fetching details for cutting:', cuttingId);

    // First get the Cutting record with all fields
    const cuttingQuery = await conn.query(
      `SELECT 
        Id,
        Name,
        Issued_Date__c,
        Issued_Weight__c,
        Returned_weight__c,
        Received_Date__c,
        Status__c,
        Cutting_loss__c
       FROM Cutting__c 
       WHERE Name = '${cuttingId}'`
    );

    if (!cuttingQuery.records || cuttingQuery.records.length === 0) {
      console.log('[Get Cutting Pouches] Cutting not found:', cuttingId);
      return res.status(404).json({
        success: false,
        message: "Cutting record not found"
      });
    }

    // Get pouches with their IDs and weights
    const pouchesQuery = await conn.query(
      `SELECT 
        Id, 
        Name,
        Issued_Weight_Cutting__c,
        Received_Weight_Cutting__c
       FROM Pouch__c 
       WHERE Cutting__c = '${cuttingId}'`
    );

    console.log('[Get Cutting Pouches] Found pouches:', pouchesQuery.records);
    console.log('[Get Cutting Pouches] Cutting details:', cuttingQuery.records[0]);

    res.json({
      success: true,
      data: {
        cutting: cuttingQuery.records[0],
        pouches: pouchesQuery.records
      }
    });

  } catch (error) {
    console.error("[Get Cutting Pouches] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cutting details"
    });
  }
});


// =============================================================================



app.get("/get-inventory-transactions", async (req, res) => {
  try {
    // Query Salesforce for issued inventory records
    const result = await conn.query(`
      SELECT 
        Id,
        Name,
        Issued_Date__c,
        Purity__c,
        Pure_Metal_weight__c,
        Alloy_Weight__c,
        CreatedDate,
        CreatedBy.Name
      FROM Issued_inventory__c
      ORDER BY CreatedDate ASC
    `);

    if (!result.records || result.records.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Inventory Issued records not found"
      });
    }

    // Map Salesforce data to desired JSON format
    const inventoryItems = result.records.map(item => ({
      id: item.Id,
      name: item.Name,
      purity: item.Purity__c,
      issuedDate: item.Issued_Date__c,
      pureMetalWeight: item.Pure_Metal_weight__c,
      alloyWeight: item.Alloy_Weight__c,
      createdDate: item.CreatedDate,
      createdByName: item.CreatedBy?.Name || null
    }));

    res.status(200).json({
      success: true,
      message: "Inventory Transaction items fetched successfully",
      data: inventoryItems
    });

  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inventory items"
    });
  }
});


// ======================  process rpeort overall with date filter ==================================================

app.get("/api/process-summary", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Convert to Salesforce DateTime format
    const fromDateTime = `${fromDate}T00:00:00Z`;
    const toDateTime = `${toDate}T23:59:59Z`;

    const processes = [
      { name: "Casting", object: "Casting_dept__c", dateField: "Issued_Date__c", fields: { issued: "Issud_weight__c", received: "Weight_Received__c", loss: "Casting_Loss__c", scrap: "Casting_Scrap_Weight__c", dust: "Casting_Dust_Weight__c" }},
      { name: "Filing", object: "Filing__c", dateField: "Issued_Date__c", fields: { issued: "Issued_weight__c", received: "Receievd_weight__c", loss: "Filing_loss__c", scrap: "Filing_Scrap_Weight__c", dust: "Filing_Dust_Weight__c" }},
      { name: "Grinding", object: "Grinding__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Received_Weight__c", loss: "Grinding_loss__c", scrap: "Grinding_Scrap_Weight__c", dust: "Grinding_Dust_Weight__c" }},
      { name: "Setting", object: "Setting__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Returned_weight__c", loss: "Setting_l__c", scrap: "Setting_Scrap_Weight__c", dust: "Setting_Dust_Weight__c" }},
      { name: "Polishing", object: "Polishing__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Received_Weight__c", loss: "Polishing_Loss__c", scrap: "Polishing_Scrap_Weight__c", dust: "Polishing_Dust_Weight__c" }},
      { name: "Dull", object: "Dull__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Returned_weight__c", loss: "Dull_loss__c", scrap: "Dull_Scrap_Weight__c", dust: "Dull_Dust_Weight__c" }},
      { name: "Plating", object: "Plating__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Returned_Weight__c", loss: "Plating_loss__c", scrap: "Plating_Scrap_Weight__c", dust: "Plating_Dust_Weight__c" }},
      { name: "Cutting", object: "Cutting__c", dateField: "Issued_Date__c", fields: { issued: "Issued_Weight__c", received: "Returned_Weight__c", loss: "Cutting_loss__c", scrap: "Cutting_Scrap_Weight__c", dust: "Cutting_Dust_Weight__c" }}
    ];

    let results = [];

    for (let p of processes) {
      const fieldList = Object.values(p.fields).filter(Boolean).join(", ");
      
      // Add date filter in SOQL
      const soql = `
        SELECT ${fieldList}
        FROM ${p.object}
        WHERE ${p.dateField} >= ${fromDateTime}
        AND ${p.dateField} <= ${toDateTime}
      `;

      const queryRes = await conn.query(soql);

      let issued = 0, received = 0, loss = 0, scrap = 0, dust = 0,processWt=0;
    
    queryRes.records.forEach(r => {
      
      console.log(p.name +" - "+r[p.fields.received]);

  const issuedVal = parseFloat(r[p.fields.issued] || 0);
  const receivedVal = parseFloat(r[p.fields.received] || 0);

  issued += issuedVal;

  // ✅ Check the actual received value
  if (receivedVal == 0) {
    processWt += issuedVal;
  }

  received += receivedVal;
  loss += parseFloat(r[p.fields.loss] || 0);
  scrap += parseFloat(p.fields.scrap ? r[p.fields.scrap] || 0 : 0);
  dust += parseFloat(r[p.fields.dust] || 0);
});



results.push({
  process: p.name,
  issued_wt: issued,
  process_wt: processWt, // ✅ now has real value
  received_wt: received,
  loss_wt: loss,
  scrap_wt: scrap,
  dust_wt: dust
});

    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Error fetching process summary:", err);
    res.status(500).json({ success: false, message: "Error fetching process summary", error: err.message });
  }
});

// ======================================================================================================================


app.get("/api/process-report", async (req, res) => {
  try {
  

    const processes = [
      { name: "Casting", object: "Casting_dept__c",  fields: { issued: "Issud_weight__c", received: "Weight_Received__c", loss: "Casting_Loss__c", scrap: "Casting_Scrap_Weight__c", dust: "Casting_Dust_Weight__c" }},
      { name: "Filing", object: "Filing__c",  fields: { issued: "Issued_weight__c", received: "Receievd_weight__c", loss: "Filing_loss__c", scrap: "Filing_Scrap_Weight__c", dust: "Filing_Dust_Weight__c" }},
      { name: "Grinding", object: "Grinding__c",  fields: { issued: "Issued_Weight__c", received: "Received_Weight__c", loss: "Grinding_loss__c", scrap: "Grinding_Scrap_Weight__c", dust: "Grinding_Dust_Weight__c" }},
      { name: "Setting", object: "Setting__c",  fields: { issued: "Issued_Weight__c", received: "Returned_weight__c", loss: "Setting_l__c", scrap: "Setting_Scrap_Weight__c", dust: "Setting_Dust_Weight__c" }},
      { name: "Polishing", object: "Polishing__c",  fields: { issued: "Issued_Weight__c", received: "Received_Weight__c", loss: "Polishing_Loss__c", scrap: "Polishing_Scrap_Weight__c", dust: "Polishing_Dust_Weight__c" }},
      { name: "Dull", object: "Dull__c",fields: { issued: "Issued_Weight__c", received: "Returned_weight__c", loss: "Dull_loss__c", scrap: "Dull_Scrap_Weight__c", dust: "Dull_Dust_Weight__c" }},
      { name: "Plating", object: "Plating__c",  fields: { issued: "Issued_Weight__c", received: "Returned_Weight__c", loss: "Plating_loss__c", scrap: "Plating_Scrap_Weight__c", dust: "Plating_Dust_Weight__c" }},
      { name: "Cutting", object: "Cutting__c", fields: { issued: "Issued_Weight__c", received: "Returned_Weight__c", loss: "Cutting_loss__c", scrap: "Cutting_Scrap_Weight__c", dust: "Cutting_Dust_Weight__c" }}
    ];

    console.log(processes);

    let results = [];

    for (let p of processes) {
      const fieldList = Object.values(p.fields).filter(Boolean).join(", ");
      
      // Add date filter in SOQL
      const soql = `SELECT ${fieldList} FROM ${p.object}`;

      const queryRes = await conn.query(soql);

      let issued = 0, received = 0, loss = 0, scrap = 0, dust = 0,processWt=0;
    

//     queryRes.records.forEach(r => {


//       console.log(p.name+" - "+r[p.fields.received])

//   const issuedVal = parseFloat(r[p.fields.issued] || 0);
//   const receivedVal = parseFloat(r[p.fields.received] || 0);

//   issued += issuedVal;

//   // ✅ Check the actual received value
//   if (receivedVal == 0) {
//     processWt += issuedVal;
//   }
//   received += receivedVal;
// });

queryRes.records.forEach(r => {
  
      // console.log(p.name+" - "+r[p.fields.received])

  const issuedRaw = r[p.fields.issued];
const receivedRaw = r[p.fields.received];

const issuedVal = parseFloat(issuedRaw || 0);
const receivedVal = receivedRaw ? parseFloat(receivedRaw) : 0;

if (!receivedRaw || receivedVal === 0) {
  processWt += issuedVal;
}

  received += receivedVal;
});



results.push({
  process: p.name,
  issued_wt: issued,
  process_wt: processWt, // ✅ now has real value
  received_wt: received,
  // loss_wt: loss,
  // scrap_wt: scrap,
  // dust_wt: dust
});


    }

    res.json({ success: true, data: results });

console.log(results)

  } catch (err) {
    console.error("Error fetching process summary:", err);
    res.status(500).json({ success: false, message: "Error fetching process summary", error: err.message });
    
  }
});



// ========================== Preview model =================================================================

// Get models for category
app.get("/api/previewModels", async (req, res) => {
  const { categoryId } = req.query;
  if (!categoryId) {
    return res.status(400).json({ error: "categoryId is required" });
  }

  try {
    const result = await conn.query(
      `SELECT Id, Name, Image_URL__c 
       FROM Jewlery_Model__c 
       WHERE Category__c = '${categoryId}'
       ORDER BY Name`
    );
    res.json(result.records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch models" });
  }
});


