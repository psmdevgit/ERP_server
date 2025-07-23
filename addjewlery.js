async function addJewelryModel(conn, data, file) {
  try {
    let imageUrl = null;

    if (file) {
      try {
        // Create ContentVersion
        const contentVersion = await conn.sobject("ContentVersion").create({
          Title: file.originalname,
          PathOnClient: file.originalname,
          VersionData: file.buffer.toString('base64'),
          IsMajorVersion: true
        });

        if (contentVersion.success) {
          // Get ContentDocumentId
          const contentDocQuery = await conn.query(
            `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${contentVersion.id}' LIMIT 1`
          );

          if (contentDocQuery.records.length > 0) {
            // Create ContentDistribution
            const contentDistribution = await conn.sobject("ContentDistribution").create({
              ContentVersionId: contentVersion.id,
              Name: `Public Distribution for ${file.originalname}`,
              PreferencesAllowViewInBrowser: true,
              PreferencesLinkLatestVersion: true,
              PreferencesNotifyOnVisit: false,
              PreferencesPasswordRequired: false,
              PreferencesAllowOriginalDownload: true
            });

            if (contentDistribution.success) {
              const distributionQuery = await conn.query(
                `SELECT ContentDownloadUrl FROM ContentDistribution WHERE Id = '${contentDistribution.id}' LIMIT 1`
              );

              if (distributionQuery.records.length > 0) {
                imageUrl = distributionQuery.records[0].ContentDownloadUrl;
                console.log("Generated image URL:", imageUrl);
              }
            }
          }
        }
      } catch (uploadError) {
        console.error("Error creating content:", uploadError);
      }
    }

    // Create jewelry data with the full distribution URL
    const jewelryData = {
      Name :data["Model-name"],
      Name__c: data["Model-name"],
      Item__c: data["item-group"],
      Design_Source__c: data["design-source"],
      Project__c: data["project"],
      Category__c: data["category"],
      Model_Name__c: data["Model-name"],
      Die_No__c: data["die-no"],
      Sketch_No__c: data["sketch-no"],
      Branch__c: data["branch"],
      Brand__c: data["brand"],
      Collection__c: data["collection"],
      Purity__c: data["purity"],
      Color__c: data["color"],
      Size__c: data["size"],
      Stone_Type__c: data["stone-type"],
      Style__c: data["style"],
      Shape__c: data["shape"],
      Stone_Setting__c: data["stone-setting"],
      Pieces__c: data["pieces"] ? parseInt(data["pieces"], 10) : null,
      Unit_Type__c: data["unit-type"],
      Rate__c: data["rate"] ? parseFloat(data["rate"]) : null,
      Minimum_Stock_Level__c: data["minimum-stock-level"]
        ? parseInt(data["minimum-stock-level"], 10)
        : null,
      Material__c: data["material"],
      Gender__c: data["gender"],
      Measurments__c: data["measurements"],
      Router__c: data["router"],
      Master_Weight__c: data["master-weight"] ? parseFloat(data["master-weight"]) : null,
      Wax_Piece__c: data["wax-piece-weight"] ? parseFloat(data["wax-piece-weight"]) : null,
      Creator__c: data["creator"],
      Gross_Weight__c: data["gross-weight"] ? parseFloat(data["gross-weight"]) : null,
      Stone_Weight__c: data["stone-weight"] ? parseFloat(data["stone-weight"]) : null,
      Net_Weight__c: data["net-weight"] ? parseFloat(data["net-weight"]) : null,
      Stone_Amount__c: data["stone-amount"] ? parseFloat(data["stone-amount"]) : null,
      Other_Weight__c: data["other-weight"] ? parseFloat(data["other-weight"]) : null,
      Other_Amount__c: data["other-amount"] ? parseFloat(data["other-amount"]) : null,
      Cad_Path__c: data["cad-path"],
      Location__c: data["location"],
      
      Image_URL__c: imageUrl  // Store the full distribution URL
    };

    const modelResult = await conn.sobject("Jewlery_Model__c").create(jewelryData);
    
    if (!modelResult.success) {
      throw new Error(`Failed to create Jewelry Model: ${modelResult.errors}`);
    }

    return { 
      success: true, 
      recordId: modelResult.id,
      imageUrl: imageUrl
    };

  } catch (error) {
    console.error("Error in addJewelryModel:", error.message);
    throw new Error(`Error in addJewelryModel: ${error.message}`);
  }
}

module.exports = { addJewelryModel };