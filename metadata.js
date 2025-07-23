const jsforce = require("jsforce");
require("dotenv").config();

const conn = new jsforce.Connection({
  loginUrl: process.env.SALESFORCE_LOGIN_URL,
});

async function initializeSalesforceConnection() {
  try {
    await conn.login(process.env.SALESFORCE_USERNAME, process.env.SALESFORCE_PASSWORD);
    console.log("Connected to Salesforce");
  } catch (error) {
    console.error("Failed to connect to Salesforce:", error.message);
    process.exit(1);
  }
}

async function createCustomFields(objectApiName, fields) {
  for (const field of fields) {
    const metadata = {
      fullName: `${objectApiName}.${field.apiName}`,
      label: field.label,
      type: field.type,
    };

    // For Text fields
    if (field.length) metadata.length = field.length;

    // For Number fields
    if (field.precision && field.scale) {
      metadata.precision = field.precision;
      metadata.scale = field.scale;
    }

    // For Picklist fields
    if (field.type === "Picklist" && field.picklistValues) {
      metadata.valueSet = {
        valueSetDefinition: {
          sorted: true,
          value: field.picklistValues.map((value) => ({
            fullName: value,
            default: false,
          })),
        },
      };
    }

    // For Long Text Area
    if (field.visibleLines) metadata.visibleLines = field.visibleLines;

    try {
      const result = await conn.metadata.create("CustomField", metadata);
      if (result.success) {
        console.log(`Field '${field.label}' created successfully.`);
      } else {
        console.error(`Failed to create field '${field.label}':`, result.errors);
      }
    } catch (error) {
      console.error(`Error creating field '${field.label}':`, error.message);
    }
  }
}

// Field definitions based on HTML inputs
const fields = [
  { apiName: "Item_Group__c", label: "Item Group", type: "Picklist", picklistValues: ["Alloy", "Design Item", "Stone"] },
  { apiName: "Design_Source__c", label: "Design Source", type: "Picklist", picklistValues: ["Inhouse", "Outsource"] },
  { apiName: "Project__c", label: "Project", type: "Picklist", picklistValues: ["ProjectA", "ProjectB"] },
  { apiName: "Category__c", label: "Category", type: "Picklist", picklistValues: ["Band Ring Plain", "Band Ring Stone"] },
  { apiName: "Model_Name__c", label: "Model Name", type: "Text", length: 255 },
  { apiName: "Image__c", label: "Image URL", type: "Text", length: 250 }, // Image Field for Base64 data
  { apiName: "Die_No__c", label: "Die No.", type: "Text", length: 255 },
  { apiName: "Sketch_No__c", label: "Sketch No.", type: "Text", length: 255 },
  { apiName: "Branch__c", label: "Branch", type: "Picklist", picklistValues: ["Needha Gold"] },
  { apiName: "Brand__c", label: "Brand", type: "Text",length:255 },
  { apiName: "Collection__c", label: "Collection", type: "Picklist", picklistValues: ["Collection1", "Collection2"] },
  { apiName: "Purity__c", label: "Purity", type: "Picklist", picklistValues: ["22k", "18k","14k"] },
  { apiName: "Color__c", label: "Color", type: "Picklist", picklistValues: ["yellow", "pink", "White"] },
  { apiName: "Size__c", label: "Size", type: "Picklist", picklistValues: ["8mm", "9mm", "10mm"] },
  { apiName: "Stone_Type__c", label: "Stone Type", type: "Picklist", picklistValues: ["Type1", "Type2"] },

  { apiName: "Style__c", label: "Style", type: "Picklist", picklistValues: ["Style1", "Style2"] },
  { apiName: "Shape__c", label: "Shape", type: "Picklist", picklistValues: ["Shape1", "Shape2"] },

  { apiName: "Stone_Setting__c", label: "Stone Setting", type: "Picklist", picklistValues: ["Setting1", "Setting2"] },
  { apiName: "Pieces__c", label: "Pieces", type: "Number", precision: 18, scale: 3 },
  { apiName: "Unit_Type__c", label: "Unit Type", type: "Picklist", picklistValues: ["Unit1", "Unit2"] },
  { apiName: "Rate__c", label: "Rate", type: "Number", precision: 18, scale: 2 },
  { apiName: "Minimum_Stock_Level__c", label: "Minimum Stock Level", type: "Number", precision: 18, scale: 3 },
  { apiName: "Material__c", label: "Material", type: "Picklist", picklistValues: ["Gold", "Silver"] },
  { apiName: "Gender__c", label: "Gender", type: "Picklist", picklistValues: ["Male", "Female", "Unisex"] },
  { apiName: "Measurements__c", label: "Measurements", type: "Text", length: 255 },
  { apiName: "Router__c", label: "Router", type: "Picklist", picklistValues: ["RouterA", "RouterB"] },
  { apiName: "Master_Weight__c", label: "Master Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Wax_Piece_Weight__c", label: "Wax Piece Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Creator__c", label: "Creator", type: "Text", length: 255 },
  { apiName: "Gross_Weight__c", label: "Gross Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Stone_Weight__c", label: "Stone Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Net_Weight__c", label: "Net Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Stone_Amount__c", label: "Stone Amount", type: "Number", precision: 18, scale: 2 },
  { apiName: "Other_Weight__c", label: "Other Weight", type: "Number", precision: 18, scale: 3 },
  { apiName: "Other_Amount__c", label: "Other Amount", type: "Number", precision: 18, scale: 2 },
  { apiName: "Cad_Path__c", label: "Cad Path", type: "Text", length: 255 },
  { apiName: "Location__c", label: "Location", type: "Text", length: 255 },
];

// Main Execution
(async () => {
  await initializeSalesforceConnection();
  const objectApiName = "Jewlery_Model__c"; // Replace with your Salesforce object API name
  await createCustomFields(objectApiName, fields);
})();
