
const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/home/nho/TikTokOrderApp/.hermes/desktop-attachments/delivery-orders-20260707-0756.xlsx')
  .then(() => {
    wb.worksheets.forEach(ws => {
      console.log(`Sheet: ${ws.name}, rowCount: ${ws.rowCount}`);
      for (let i = 1; i <= 5; i++) {
        const row = ws.getRow(i);
        const vals = [];
        for (let c = 1; c <= 10; c++) {
          vals.push(row.getCell(c).value);
        }
        console.log(`Row ${i}:`, JSON.stringify(vals));
      }
    });
  })
  .catch(err => console.error(err));
