import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import lucide from "lucide";
import Papa from "papaparse";
const { Pencil, PhoneCall, RotateCcw, ReceiptText, Trash2 } = lucide;

const html = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], {
  value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, open: false,
  elements: [], listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; },
  showModal() { this.open = true; }, close() { this.open = false; },
}]));
elements.get("statusFilter").value = "all";
const context = vm.createContext({ document: { getElementById: (id) => elements.get(id) }, Papa, Pencil, PhoneCall, RotateCcw, ReceiptText, Trash2, URL, console, crypto: { randomUUID: () => `test-${Math.random()}` } });
const source = fs.readFileSync(new URL("../dist/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace('const supabase = configured ? createClient(url, key) : null;', 'let supabase = null;')
  .replace(/import\.meta\.env\.\w+/g, '""');
vm.runInContext(source, context);
vm.runInContext(`patients = [
  {id:"pending", name:"Test <Patient>", phone:"555 / 556", reason:"Brain mapping", scheduled_date:"2026-10-12", notes:"Follow up tomorrow", message_attempts:2, status:"pending"},
  {id:"done", name:"Completed Patient", phone:"557", reason:"Cognitive assessment", status:"called", calledAt:"2026-10-12T09:00:00Z"}
]; render();`, context);
assert.match(elements.get("patientList").innerHTML, /Left message twice/);
assert.match(elements.get("patientList").innerHTML, /Test &lt;Patient&gt;/);
assert.match(elements.get("patientList").innerHTML, /Follow up tomorrow/);
assert.equal((elements.get("patientList").innerHTML.match(/data-action="receipt"/g) || []).length, 1);
elements.get("statusFilter").value = "message";
vm.runInContext("render()", context);
assert.equal(elements.get("resultCount").textContent, "1 of 2 patients");
assert.doesNotMatch(elements.get("patientList").innerHTML, /Completed Patient/);
elements.get("statusFilter").value = "all";
elements.get("patientSearch").value = "tomorrow";
vm.runInContext("render()", context);
assert.equal(elements.get("resultCount").textContent, "1 of 2 patients");
elements.get("patientSearch").value = "nonexistent";
vm.runInContext("render()", context);
assert.match(elements.get("patientList").innerHTML, /No patients match/);
elements.get("patientSearch").value = "";
const parsedImport = vm.runInContext(`parseBulkPatients("Patient,Phone,Description,Scheduled Date,Notes\\nJordan Lee,9515550100,Brain mapping,10/13/2026,Prefers morning\\nMissing Phone,,Lab result review,2026-10-14,")`, context);
assert.equal(parsedImport.length, 2);
assert.equal(parsedImport[0].valid, true);
assert.equal(parsedImport[0].patient.name, "Jordan Lee");
assert.equal(parsedImport[0].patient.scheduled_date, "2026-10-13");
assert.equal(parsedImport[0].patient.notes, "Prefers morning");
assert.equal(parsedImport[1].valid, false);
assert.equal(parsedImport[1].issues.join(", "), "Phone missing");
const inferredImport = vm.runInContext(`parseBulkPatients("Avery Khan - +1 (951) 555-0188 - Follow-up consultation - 2026-10-15 - Left message")`, context);
assert.equal(inferredImport[0].patient.phone, "+1 (951) 555-0188");
assert.equal(inferredImport[0].patient.message_attempts, 1);

function parseImport(text) {
  context.importText = text;
  return vm.runInContext("parseBulkPatients(importText)", context);
}
// Synthetic clinic rows mirror the supplied layout without storing patient data.
const clinicCsv = [
  'Jordan Lee COG 3:00PM,COGNITIVE,2/6/1954,Alex (626) 555-0100 or 626-555-0101,,Mission Healthcare',
  'Avery Khan COG 1:30 PM,COGNITIVE,7/4/1940,Casey 909-555-0102,,',
  'Home Health Services (909) 555-0103,,,,,',
  'Morgan Chen BP 4:30 PM,BRAIN MAPPING,12/9/1972,,,',
  'Sam dtr 562-555-0104 or Facility 714-555-0105,,,,,',
  '714-555-0105 GEM CARE,,#,,,',
].join('\r\n');
const clinicRows = parseImport(clinicCsv);
assert.equal(clinicRows.length, 3);
assert.equal(clinicRows.every(row => row.valid), true);
assert.equal(clinicRows[0].patient.name, 'Jordan Lee');
assert.equal(clinicRows[0].patient.reason, 'Cognitive assessment');
assert.equal(clinicRows[0].patient.phone, '(626) 555-0100 / 626-555-0101');
assert.equal(clinicRows[0].patient.date_of_birth, '1954-02-06');
assert.equal(clinicRows[0].patient.notes, '');
assert.equal(clinicRows[0].patient.contact_person_name, 'Alex');
assert.equal(clinicRows[0].patient.facility, 'Mission Healthcare');
assert.equal(clinicRows[1].patient.facility, 'Home Health Services');
assert.equal(clinicRows[1].patient.contact_person_name, 'Casey');
assert.equal(clinicRows[1].patient.notes, '');
assert.equal(clinicRows[2].patient.phone, '562-555-0104 / 714-555-0105');
assert.equal(clinicRows[2].patient.facility, 'GEM CARE');
assert.equal(clinicRows[2].patient.contact_person_name, 'Sam');
assert.equal(clinicRows[2].patient.notes, '');
assert.equal(clinicRows.every(row => row.patient.scheduled_date === null && row.patient.status === 'pending' && row.patient.message_attempts === 0), true);
const clinicTsv = Papa.unparse(Papa.parse(clinicCsv).data, {delimiter:'\t'});
assert.equal(parseImport(clinicTsv).length, 3);
assert.equal(parseImport(clinicTsv)[2].patient.phone, clinicRows[2].patient.phone);
const markdownPatients = Array.from({length:8},(_,index) => [
  `Example Patient ${index + 1} ${index === 7 ? 'BP 4:30 PM' : index === 6 ? 'COG 3:30' : 'COG 3:00PM'}`,
  index === 7 ? 'BRAIN MAPPING' : 'COGNITIVE', '2/6/1954',
  index === 7 ? 'Linda dtr 562-555-0104 or Facility 714-555-0105 or Adriel Pao 949-555-0106' : 'Stephanie 909-555-0102 or (626) 555-0103',
  '', index === 7 ? '714-555-0105 ANNISSA GEM CARE' : 'Mission Healthcare Ontario', '', index === 7 ? '#' : '', ...Array(27).fill(''),
]);
const markdownRow = row => '| '+row.map(cell => cell === '#' ? '**#**"' : cell ? `**${cell}**` : ' ').join(' | ')+' |';
const markdownText = '"\n'+markdownRow(markdownPatients[0])+'\n| '+markdownPatients[0].map((_,index) => index === 1 ? '---:' : '-').join(' | ')+' |\n'+markdownPatients.slice(1).map(markdownRow).join('\n')+'\n"';
const markdownRows = parseImport(markdownText);
assert.equal(markdownRows.length,8);
assert.equal(markdownRows.every(row=>row.valid),true);
assert.equal(markdownRows[0].patient.name,'Example Patient 1');
assert.equal(markdownRows[0].patient.date_of_birth,'1954-02-06');
assert.equal(markdownRows[0].patient.appointment_time,'3:00PM');
assert.equal(markdownRows[0].patient.contact_person_name,'Stephanie');
assert.equal(markdownRows[0].patient.facility,'Mission Healthcare Ontario');
assert.equal(markdownRows[6].patient.appointment_time,'3:30');
assert.equal(markdownRows[7].patient.reason,'Brain mapping');
assert.equal(markdownRows[7].patient.contact_person_name,'Linda / Adriel Pao');
assert.equal(markdownRows[7].patient.facility,'ANNISSA GEM CARE');
assert.equal(markdownRows[7].patient.phone,'562-555-0104 / 714-555-0105 / 949-555-0106');
assert.equal(markdownRows.every(row=>!row.patient.notes && row.patient.scheduled_date === null && row.patient.status === 'pending'),true);
const pipeHeaders = '| **Name** | **Description** | **Contact Details** | **Customer Person Name** | **Notes** |\n| :--- | --- | ---: | --- | --- |\n| **Jordan Lee** | Review | 9095550102 | **Alex Lee** | Patient asked for "morning" call |';
assert.equal(parseImport(pipeHeaders)[0].patient.contact_person_name,'Alex Lee');
assert.equal(parseImport(pipeHeaders)[0].patient.notes,'Patient asked for "morning" call');
assert.equal(parseImport('| --- | :---: | ---: |').length,0);
const quoted = parseImport('\uFEFFName,Phone,Description,Date,Notes\n"Lee, Jordan",9515550100,Review,2026-10-19,"First line\nSecond line, with comma and ""quotes"""');
assert.equal(quoted.length, 1);
assert.equal(quoted[0].valid, true);
assert.equal(quoted[0].patient.name, 'Lee, Jordan');
assert.equal(quoted[0].patient.notes, 'First line\nSecond line, with comma and "quotes"');
assert.equal(parseImport('Name;Phone;Service;DOB;Facility\nJordan;9515550100;Review;2/6/1954;Home Health')[0].patient.scheduled_date, null);
assert.equal(parseImport('Jordan BP 4:00 PM,BRAIN MAPPING,2/30/1954,,,')[0].valid, false);
assert.equal(parseImport('Jordan BP 4:00 PM,BRAIN MAPPING,2/6/1954,,,')[0].issues.includes('Phone missing'), true);
assert.equal(parseImport('Name,Phone,Description\n"Jordan,9515550100,Review')[0].valid, false);
assert.equal(parseImport('Name,Phone,Description,Status\nJordan,9515550100,Review,Not called')[0].patient.status, 'pending');
assert.equal(parseImport('Name,Phone,Description,Notes\nJordan,9515550100,Review,Called facility at 12 PM')[0].patient.message_attempts, 0);

const updatedCsv = Papa.unparse([
  ['Name','Description','Date of Birth','Facility','Appointment Time','Contact Person Name','Contact Details','Notes'],
  ['Jordan Lee','COGNITIVE','2/6/1954','Home Health','3:00 PM','Alex Lee','(626) 555-0100 / (626) 555-0101','Caregiver requested a call'],
  ['Avery Khan','BRAIN MAPPING','12/9/1972','Care Facility','4:30 PM','Casey','','Phone not provided'],
]);
const updatedRows = parseImport(updatedCsv);
assert.equal(updatedRows.length, 2);
assert.equal(updatedRows[0].valid, true);
assert.equal(updatedRows[0].patient.phone, '(626) 555-0100 / (626) 555-0101');
assert.equal(updatedRows[0].patient.scheduled_date, null);
assert.equal(updatedRows[0].patient.date_of_birth, '1954-02-06');
assert.equal(updatedRows[0].patient.facility, 'Home Health');
assert.equal(updatedRows[0].patient.appointment_time, '3:00 PM');
assert.equal(updatedRows[0].patient.contact_person_name, 'Alex Lee');
assert.equal(updatedRows[0].patient.notes, 'Caregiver requested a call');
assert.match(updatedRows[0].patient.notes, /Caregiver requested a call/);
assert.equal(updatedRows[1].valid, false);
assert.equal(updatedRows[1].issues.join(', '), 'Phone missing');
assert.equal(parseImport(Papa.unparse(Papa.parse(updatedCsv).data, {delimiter:'\t'}))[0].patient.phone, updatedRows[0].patient.phone);
const cleanupNotes = 'Appointment time: 1:30 PM\nFacility: Mission Healthcare Ontario\nContact details: Stephanie 909-555-0102 or (626) 555-0103\nPrefers an afternoon callback';
context.cleanupRecord = {name:'Example Patient',phone:'909-555-0102 / (626) 555-0103',notes:cleanupNotes};
const cleaned = vm.runInContext('patientDetails(cleanupRecord)',context);
assert.equal(cleaned.contact_person_name,'Stephanie');
assert.equal(cleaned.facility,'Mission Healthcare Ontario');
assert.equal(cleaned.appointment_time,'1:30 PM');
assert.equal(cleaned.notes,'Prefers an afternoon callback');
context.cleanedRecord = {...context.cleanupRecord,...cleaned};
assert.equal(JSON.stringify(vm.runInContext('patientDetails(cleanedRecord)',context)),JSON.stringify(cleaned));
const customerCsv = Papa.unparse([
  ['Name','Description','Customer Person Name','Contact Details','Notes'],
  ['Example Patient','Review','','909-555-0102',cleanupNotes],
]);
const customer = parseImport(customerCsv)[0].patient;
assert.equal(customer.contact_person_name,'Stephanie');
assert.equal(customer.notes,'Prefers an afternoon callback');
assert.equal(customer.phone,'909-555-0102 / (626) 555-0103');
const relatives = parseImport('Name,Phone,Description,Notes\nJordan,9095550102,Review,"Original contact details: Linda dtr 562-555-0104 or Facility 714-555-0105 or Adriel Pao 949-555-0106"')[0].patient;
assert.equal(relatives.contact_person_name,'Linda / Adriel Pao');
assert.equal(relatives.notes,'');
context.preservedNote={phone:'9095550102',notes:'Please call Stephanie at 909-555-0102 tomorrow'};
assert.equal(vm.runInContext('patientDetails(preservedNote).notes',context),context.preservedNote.notes);
context.duplicateContact={phone:'9095550102',contact_person_name:'Alex Lee',notes:'Contact details: Alex 9095550102'};
assert.equal(vm.runInContext('patientDetails(duplicateContact).notes',context),'');
assert.equal(vm.runInContext('patientDetails(duplicateContact).contact_person_name',context),'Alex Lee');

if (process.argv[2]) {
  const attachedCsv = fs.readFileSync(process.argv[2], 'utf8');
  const imported = parseImport(attachedCsv);
  const sourcePatients = Papa.parse(attachedCsv, {skipEmptyLines:'greedy'}).data.filter(row => /^(COGNITIVE|BRAIN MAPPING)$/.test(row[1]));
  assert.equal(imported.length, sourcePatients.length);
  assert.equal(imported.every(row => row.valid), true);
  imported.forEach((row, index) => {
    assert.equal(row.patient.scheduled_date, null);
    assert.equal(row.patient.status, 'pending');
    context.sourceBirthDate = sourcePatients[index][2];
    assert.equal(row.patient.date_of_birth, vm.runInContext('parseDateValue(sourceBirthDate)', context));
  });
  console.log(`Attached CSV verified: ${imported.length} valid patients; continuation rows merged.`);
}
elements.get("patientList").listeners.click({ target: { closest: () => ({ dataset: { action:"receipt", id:"done" } }) } });
assert.equal(elements.get("receiptDialog").open, true);
assert.equal(elements.get("receiptPatient").textContent, "Completed Patient");
elements.get("closeReceipt").listeners.click();
assert.equal(elements.get("receiptDialog").open, false);
elements.get("patientList").listeners.click({ target: { closest: () => ({ dataset: { action:"select", id:"pending" } }) } });
assert.equal(elements.get("patientDialog").open, true);
assert.equal(elements.get("pendingCount").textContent, 1);
elements.get('patientDialog').close();
const clickDelete = id => elements.get('patientList').listeners.click({target:{closest:() => ({dataset:{action:'delete',id}})}});
assert.equal((elements.get('patientList').innerHTML.match(/data-action="delete"/g) || []).length, 2);
clickDelete('pending');
assert.equal(elements.get('deletePatientDialog').open, true);
assert.equal(elements.get('deletePatientName').textContent, 'Test <Patient>');
elements.get('cancelDeletePatient').listeners.click();
assert.equal(elements.get('deletePatientDialog').open, false);
assert.equal(vm.runInContext('patients.length',context), 2);
await assert.rejects(vm.runInContext('deletePatient("pending")', context), /Sign in/);
const deleteCalls = [];
let deleteResult = {data:null, error:{code:'23503'}};
context.testSupabase = {from(table) {
  deleteCalls.push(['from',table]);
  const query = {delete() { deleteCalls.push(['delete']); return query; }, eq(field,value) { deleteCalls.push(['eq',field,value]); return query; }, select(value) { deleteCalls.push(['select',value]); return query; }, async maybeSingle() { return deleteResult; }};
  return query;
}};
vm.runInContext('supabase = testSupabase; user = {id:"test-owner"}; dataReady = true;', context);
clickDelete('pending');
await elements.get('deletePatientForm').listeners.submit({preventDefault(){}});
assert.equal(elements.get('deletePatientDialog').open, true);
assert.equal(elements.get('deletePatientMessage').hidden, false);
assert.match(elements.get('deletePatientMessage').textContent, /saved call history/);
assert.equal(vm.runInContext('patients.length', context), 2);
assert.equal(vm.runInContext('busy',context), false);
assert.ok(deleteCalls.some(call => call[0] === 'eq' && call[1] === 'doctor_id' && call[2] === 'test-owner'));
deleteResult = {data:null, error:{message:'Network unavailable'}};
await elements.get('deletePatientForm').listeners.submit({preventDefault(){}});
assert.match(elements.get('deletePatientMessage').textContent, /Network unavailable/);
assert.equal(vm.runInContext('patients.length',context), 2);
deleteResult = {data:null,error:null};
await elements.get('deletePatientForm').listeners.submit({preventDefault(){}});
assert.match(elements.get('deletePatientMessage').textContent, /could not be deleted/);
assert.equal(vm.runInContext('patients.length',context), 2);
deleteResult = {data:{id:'pending'},error:null};
await elements.get('deletePatientForm').listeners.submit({preventDefault(){}});
assert.equal(elements.get('deletePatientDialog').open, false);
assert.equal(vm.runInContext('patients.length',context), 1);
assert.equal(vm.runInContext('selectedId',context), 'done');
assert.equal(elements.get('pendingCount').textContent, 0);
assert.doesNotMatch(elements.get('patientList').innerHTML, /Test &lt;Patient&gt;/);
assert.match(elements.get('queueMessage').textContent, /was deleted/);
clickDelete('done');
deleteResult = {data:{id:'done'},error:null};
await elements.get('deletePatientForm').listeners.submit({preventDefault(){}});
assert.equal(vm.runInContext('patients.length',context), 0);
assert.match(elements.get('patientList').innerHTML, /No patients in your queue/);
context.structuredPatient = updatedRows[0].patient;
vm.runInContext('patients = [structuredPatient]; bulkImportRows = [{index:1,patient:structuredPatient,valid:true,issues:[]}]; render();',context);
const sheetHeaders = ['Name','Description','Date of Birth','Facility','Appointment Time','Customer Person Name','Contact Details','Appointment Date','Notes'];
const headings = id => [...elements.get(id).innerHTML.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match=>match[1]);
assert.deepEqual(headings('patientList').slice(0,9),sheetHeaders);
assert.deepEqual(headings('bulkImportPreview').slice(1,10),sheetHeaders);
assert.match(elements.get('patientList').innerHTML,/Alex Lee/);
assert.match(elements.get('patientList').innerHTML,/Home Health/);
assert.match(elements.get('patientList').innerHTML,/3:00 PM/);
elements.get('patientSearch').value='Home Health';
vm.runInContext('render()',context);
assert.equal(elements.get('resultCount').textContent,'1 of 1 patients');
elements.get('patientSearch').value='Alex Lee';
vm.runInContext('render()',context);
assert.equal(elements.get('resultCount').textContent,'1 of 1 patients');
elements.get('patientSearch').value='';
const legacyDetails = vm.runInContext('patientDetails({date_of_birth:null,facility:null,appointment_time:null,contact_person_name:null,notes:"Date of birth: 2/6/1954\\nFacility: Legacy Clinic\\nAppointment Time: 3:30\\nContact Person Name: Alex"})',context);
assert.equal(legacyDetails.date_of_birth,'1954-02-06');
assert.equal(legacyDetails.facility,'Legacy Clinic');
assert.equal(legacyDetails.appointment_time,'3:30');
assert.equal(legacyDetails.contact_person_name,'Alex');
assert.equal(vm.runInContext('patientDetails({date_of_birth:null,facility:"Current clinic",appointment_time:"",contact_person_name:"",notes:"Facility: Old clinic"}).facility',context),'Current clinic');
context.FormData = class { constructor(form) { this.values = form.testValues; } get(key) { return this.values[key] ?? null; } };
let inserted, updated;
context.writeClient = {from(table) {
  assert.equal(table,'patients');
  return {async insert(value) {inserted=value;return {error:null};},update(value) {updated=value;return {async eq() {return {error:null};}};}};
}};
vm.runInContext('supabase = writeClient; refresh = async () => { render(); };',context);
const formDetails = {date_of_birth:'1954-02-06',facility:'Saved Clinic',appointment_time:'3:30',contact_person_name:'Saved Contact'};
let resetCalled = false;
await elements.get('patientForm').listeners.submit({preventDefault(){},currentTarget:{testValues:{...formDetails,patientName:'Saved Patient',patientReason:'Review',patientPhone:'5550100',notes:'Original notes'},reset(){resetCalled=true;}}});
assert.equal(resetCalled,true);
for (const [key,value] of Object.entries(formDetails)) assert.equal(inserted[key],value);
assert.equal(inserted.doctor_id,'test-owner');
elements.get('patientList').listeners.click({target:{closest:()=>({dataset:{action:'select',id:inserted.id}})}});
await elements.get('editPatientForm').listeners.submit({preventDefault(){},currentTarget:{testValues:{...formDetails,name:'Saved Patient',reason:'Review',phone:'5550100',outcome:'pending',notes:'Updated notes',facility:'Edited Clinic'}}});
assert.equal(updated.facility,'Edited Clinic');
assert.equal(updated.date_of_birth,formDetails.date_of_birth);
assert.equal(updated.appointment_time,'3:30');
assert.equal(updated.contact_person_name,'Saved Contact');
context.importRows = updatedRows;
vm.runInContext('bulkImportRows = importRows;',context);
await elements.get('bulkImportForm').listeners.submit({preventDefault(){}});
assert.equal(inserted.length,1);
assert.equal(inserted[0].date_of_birth,'1954-02-06');
assert.equal(inserted[0].facility,'Home Health');
assert.equal(inserted[0].appointment_time,'3:00 PM');
assert.equal(inserted[0].contact_person_name,'Alex Lee');
assert.equal(inserted[0].phone,'(626) 555-0100 / (626) 555-0101');
assert.equal(inserted[0].doctor_id,'test-owner');
console.log("Portal checks passed: sheet-column mapping, list/preview columns, search, legacy notes, add/edit persistence, and deletion.");
