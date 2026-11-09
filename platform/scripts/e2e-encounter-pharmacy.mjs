import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

// Exercise the rendered UI against the disposable outpatient database.
export async function verifyEncounterPharmacy({ pg, facility, admin, storeId, origin, adminPassword }) {
  const patientId = randomUUID(), visitId = randomUUID(), encounterId = randomUUID();
  await pg.query(`INSERT INTO "Patient" (id,"facilityId","patientNumber","fullName","normalizedName","sexAtBirth","updatedAt")
    VALUES ($1,$2,'E2E-TWO','Synthetic two medicines','synthetic two medicines','UNKNOWN',now())`, [patientId,facility.id]);
  await pg.query(`INSERT INTO "Visit" (id,"facilityId","patientId","visitNumber",clinic,"visitType",status,reason,"updatedAt")
    VALUES ($1,$2,$3,'V-TWO','Outpatient','WALK_IN','UNDER_CONSULTATION','Synthetic verification',now())`, [visitId,facility.id,patientId]);
  await pg.query(`INSERT INTO "Encounter" (id,"visitId","clinicianId",status,"updatedAt") VALUES ($1,$2,$3,'DRAFT',now())`, [encounterId,visitId,admin.id]);
  await pg.query(`INSERT INTO "Diagnosis" (id,"encounterId",type,description,code,"primary") VALUES ($1,$2,'FINAL','Synthetic indication','MG30.0',true)`,[randomUUID(),encounterId]);
  await pg.query(`INSERT INTO "Invoice" (id,"visitId","patientId","invoiceNumber","updatedAt") VALUES ($1,$2,$3,'INV-TWO',now())`,[randomUUID(),visitId,patientId]);
  const medicines = [
    { code:"SIM-ALPHA", price:12.5, dose:"1", frequency:2, days:3, quantity:6, cost:75 },
    { code:"SIM-BETA", price:8.25, dose:"2", frequency:1, days:2, quantity:4, cost:33 },
  ];
  for (const m of medicines) {
    const item = randomUUID(), batch = randomUUID();
    const defaults = { route:"Oral",frequencyPerDay:m.frequency,durationDays:m.days,doseUnit:"tablet",doseUnitsPerIssueUnit:1,wholeIssueUnits:true };
    await pg.query(`INSERT INTO "CatalogItem" (id,"facilityId",category,code,name,"genericName","medicationConceptId",strength,"dosageForm","unitOfMeasure","unitPrice","prescribingDefaults","updatedAt")
      VALUES ($1,$2,'PHARMACEUTICAL',$3,$3,$3,$3,'synthetic','Tablet','tablet',$4,$5,now())`,[item,facility.id,m.code,m.price,m.code === "SIM-ALPHA" ? JSON.stringify(defaults) : null]);
    await pg.query(`INSERT INTO "InventoryBatch" (id,"catalogItemId","batchNumber","expiryDate","quantityReceived","quantityAvailable","unitCost")
      VALUES ($1,$2,$3,CURRENT_DATE + 365,20,20,2)`,[batch,item,m.code]);
    await pg.query(`INSERT INTO "InventoryLocationBalance" (id,"storeId","batchId",quantity,"updatedAt") VALUES ($1,$2,$3,20,now())`,[randomUUID(),storeId,batch]);
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch(existsSync(chrome) ? {executablePath:chrome} : {});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page.getByLabel("Email").fill("admin@mwein.local");
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button",{name:"Sign in securely"}).click();
    await page.getByRole("button",{name:"Consultation",exact:true}).click();
    await page.getByRole("button",{name:/Synthetic two medicines/}).click();
    const sections = page.getByRole("navigation", {name:"Encounter sections"});
    await sections.getByRole("button", {name:"Prescription",exact:true}).click();
    const list = page.getByRole("table",{name:"Saved prescriptions"});
    for (const m of medicines) {
      await page.getByPlaceholder("Search medicine by generic, brand or strength…").fill(m.code);
      await page.getByRole("button",{name:new RegExp(m.code)}).click();
      await page.locator('[name="dose"]').fill(m.dose);
      if (m.code === "SIM-BETA") {
        await page.locator('[name="route"]').selectOption("Oral");
        await page.locator('[name="frequencyPerDay"]').selectOption(String(m.frequency));
        await page.locator('[name="durationDays"]').fill(String(m.days));
      }
      await expect(page.getByLabel("Calculated dispensing quantity")).toHaveValue(String(m.quantity));
      const save = page.getByRole("button",{name:"Save prescription",exact:true});
      await expect(save).toHaveCount(1);
      const confirmed = page.waitForResponse(r=>r.url().endsWith("/consultation") && r.request().method()==="POST");
      await save.click();
      const res=await confirmed;
      expect(res.status(),await res.text()).toBe(200);
      await expect(list.getByRole("row").filter({hasText:m.code})).toContainText("KES "+m.cost.toFixed(2));
    }
    await expect(list.locator("tbody tr")).toHaveCount(2);
    const lines=async()=> (await pg.query(`SELECT p."medicineCode",i.quantity,i."unitPrice" FROM "InvoiceItem" i JOIN "Prescription" p ON p."orderId"=i."orderId" JOIN "ClinicalOrder" o ON o.id=p."orderId" WHERE o."visitId"=$1 ORDER BY p."medicineCode"`,[visitId])).rows;
    expect(await lines()).toHaveLength(0);
    await sections.getByRole("button",{name:"Procedures",exact:true}).click();
    await page.locator('[name="procedure_name"]').fill("Synthetic wound dressing");
    await page.locator('[name="procedure_performedAt"]').fill(new Date(Date.now()+3*3600000-60000).toISOString().slice(0,16));
    for (const field of ["indication","consentNote","anaesthesia","findings","complications","aftercare"]) {
      await page.locator(`[name="procedure_${field}"]`).fill("Synthetic verification");
    }
    const procedureSaved = page.waitForResponse(r=>r.url().endsWith("/consultation") && r.request().method()==="POST");
    await page.getByRole("button",{name:"Record completed procedure"}).click();
    const procedureResponse = await procedureSaved;
    expect(procedureResponse.status(),await procedureResponse.text()).toBe(200);
    await expect(page.getByLabel("Unsaved consultation changes")).toHaveCount(0);
    await page.getByRole("button",{name:"← Home",exact:true}).click();
    await page.getByRole("button",{name:"Pharmacy & stock",exact:true}).click();
    await page.getByRole("button",{name:/Synthetic two medicines/}).click();
    const pharmacy = page.getByLabel("Pharmacy prescription list");
    for (const m of medicines) {
      const row=pharmacy.getByRole("row").filter({hasText:m.code});
      await expect(row.getByRole("status")).toHaveText(String(m.quantity));
      await expect(row).toContainText("KES "+m.cost.toFixed(2));
      await expect(page.locator('form:visible [name="quantity"]')).toHaveCount(0);
      const response=page.waitForResponse(r=>r.url().endsWith("/dispense") && r.request().method()==="POST");
      await row.getByRole("button",{name:"Dispense & confirm counselling"}).click();
      const res=await response;
      expect(res.status(),await res.text()).toBe(200);
      await expect(row).toContainText("DISPENSED");
      const replay = await page.evaluate(async ({url, body}) => {
        const response = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
        return { status:response.status, result:await response.json() };
      }, { url:res.url(), body:res.request().postDataJSON() });
      expect(replay.status,JSON.stringify(replay.result)).toBe(200);
      expect(replay.result.replayed).toBe(true);
    }
    await expect(pharmacy.getByRole("button")).toHaveCount(0);
    const charges=await lines();
    expect(charges.map(i=>[i.medicineCode,Number(i.quantity),Number(i.unitPrice)])).toEqual(medicines.map(m=>[m.code,m.quantity,m.price]));
    for(const m of medicines){
      const {rows}=await pg.query(`SELECT b."quantityAvailable", (SELECT count(*)::int FROM "Dispensation" d JOIN "Prescription" p ON p.id=d."prescriptionId" WHERE p."medicineCode"=$1) AS receipts FROM "InventoryBatch" b WHERE b."batchNumber"=$1`,[m.code]);
      expect([Number(rows[0].quantityAvailable),rows[0].receipts]).toEqual([20-m.quantity,1]);
    }
    console.log("Verified two browser saves and supplies: 6 × KES 12.50 and 4 × KES 8.25, two charges totalling KES 108 after retries.");
  } catch(error) {
    const page=browser.contexts()[0]?.pages()[0];
    if(page)console.error((await page.locator("body").innerText()).slice(-2400));
    throw error;
  } finally {await browser.close();}
}
