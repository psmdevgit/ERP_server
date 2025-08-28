async function subOrderwithItems(conn, orderData,designPDFurl, detailedPdfUrl, pdfFile) {
    try {

        console.log("image : ",designPDFurl);        
        console.log("detailed : ",detailedPdfUrl);
        console.log("order pdf:",pdfFile);

        // Find Party Ledger first
        const partyLedgerQuery = await conn.query(
            `SELECT Id FROM Party_Ledger__c WHERE Party_Code__c = '${orderData.orderInfo.partyCode}' LIMIT 1`
        );

        let partyLedgerId = null;
        if (partyLedgerQuery.records.length > 0) {
            partyLedgerId = partyLedgerQuery.records[0].Id;
        }

        // Handle PDF upload
        let pdfUrl = null;
        if (pdfFile) {
            try {
                // Create ContentVersion
                const contentVersion = await conn.sobject("ContentVersion").create({
                    Title: pdfFile.originalname || `Order_${orderData.orderInfo.orderNo}.pdf`,
                    PathOnClient: pdfFile.originalname || `Order_${orderData.orderInfo.orderNo}.pdf`,
                    VersionData: pdfFile.buffer.toString('base64'),
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
                            Name: `Public Distribution for Order ${orderData.orderInfo.orderNo}`,
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
                                pdfUrl = distributionQuery.records[0].ContentDownloadUrl;
                                console.log("Generated PDF URL:", pdfUrl);
                            }
                        }
                    }
                }
            } catch (uploadError) {
                console.error("Error creating content:", uploadError);
            }
        }

        console.log("opdf url :",pdfUrl);

        // Create order record
        const orderRecord = {
            Name: orderData.orderInfo.orderNo,
            Party_Code__c: orderData.orderInfo.partyCode,
            Party_Name__c: orderData.orderInfo.partyName,
            Order_Id__c: orderData.orderInfo.orderNo,
            Category__c: orderData.orderInfo.category,
            Advance_Metal__c: orderData.orderInfo.advanceMetal,
            Purity__c: orderData.orderInfo.purity,
            Advance_Metal_Purity__c: orderData.orderInfo.advanceMetalPurity,
            Priority__c: orderData.orderInfo.priority,
            Delivery_Date__c: orderData.orderInfo.deliveryDate,
            Created_By__c: orderData.orderInfo.createdBy,
            Created_Date__c: orderData.orderInfo.orderDate,
            Pdf__c: pdfUrl,
            // Link to Party Ledger if found
            Party_Ledger__c: partyLedgerId,
            Status__c : "Open"
        };

        const orderResult = await conn.sobject("Order__c").create(orderRecord);
        if (!orderResult.success) {
            throw new Error(`Failed to create Order: ${orderResult.errors}`);
        }

         

        // Create order items
        if (orderData.items && orderData.items.length > 0) {
            const orderItems = orderData.items.map(item => ({
                Name: item.modelName,
                Category__c: item.category,
                Quantity__c: item.quantity,
                Size__c: item.size,
                Net_Weight__c: item.netWeight,
                Stone_Weight__c: item.stoneWeight,
                Gross_Weight__c: item.grossWeight,
                Remarks__c: item.itemRemark,
                Order_Image_sheet__c: designPDFurl,
                Order_sheet__c: detailedPdfUrl,
                Order__c: orderResult.id
            }));

            console.log(orderItems);

            const itemResults = await conn.sobject("Order_Models__c").create(orderItems);
            
            const failedItems = itemResults.filter(result => !result.success);
            if (failedItems.length > 0) {
                throw new Error(`Failed to create some order items: ${JSON.stringify(failedItems)}`);
            }
        }

        return {
            success: true,
            recordId: orderResult.id,
            pdfUrl: pdfUrl,
            partyLedgerId: partyLedgerId
        };

    } catch (error) {
        console.error("Error in submitOrder:", error.message);
        throw new Error(`Error in submitOrder: ${error.message}`);
    }
}

module.exports = {
    subOrderwithItems
};

