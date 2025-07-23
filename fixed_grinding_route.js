app.get("/api/grinding/:prefix/:date/:month/:year/:number/:subnumber", async (req, res) => {
  try {
    const { prefix, date, month, year, number, subnumber } = req.params;
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
