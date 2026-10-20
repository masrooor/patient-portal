import { createClient } from "@supabase/supabase-js";
import { Pencil, PhoneCall, RotateCcw, ReceiptText, Trash2 } from "lucide";
import Papa from "papaparse";
import { createReceiptPdf } from "./receipt.js";

const defaultDoctor = { name: "Dr. Amina Shah", specialty: "Consultant Physician", registration: "Demo provider: PMDC Reg. 18472-D", clinic: "Body & Soul Health Center", address: "1101 California Ave, STE 100-19, Corona, CA 92881", email: "info@bodyandsoulhealthcenter.com" };
const doctor = { ...defaultDoctor };
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && key && !url.includes("your-project") && !key.includes("your_key"));
const supabase = configured ? createClient(url, key) : null;
const $ = (id) => document.getElementById(id);
let user = null, busy = false, selectedId = null, patients = [], dataReady = false;
let receiptUrl = null, receiptFor = null;
let calls = [], receipts = [];
let editingId = null;
let deletingId = null;
let bulkImportRows = [];
let bulkFileRead = 0;
function patientStatus(p) { return p.status === "called" ? "Done" : p.message_attempts >= 2 ? "Left message twice" : p.message_attempts === 1 ? "Left message" : "Pending"; }
function scheduledDate(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "--"; }
function message(text) {
  if ($("appMessage")) $("appMessage").textContent = text;
  $("queueMessage").textContent = text;
  $("queueMessage").hidden = !text;
}
function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function selected() { return patients.find((p) => p.id === selectedId); }
const patientColumns = [
  ["name", "Name", 180], ["reason", "Description", 180], ["date_of_birth", "Date of Birth", 120],
  ["facility", "Facility", 240], ["appointment_time", "Appointment Time", 130],
  ["contact_person_name", "Customer Person Name", 180], ["phone", "Contact Details", 240],
  ["scheduled_date", "Appointment Date", 130], ["notes", "Notes", 280], ["status", "Status", 120],
];
function patientDetails(p = {}) {
  const structured = [p.date_of_birth, p.facility, p.appointment_time, p.contact_person_name].some((value) => value != null);
  const legacy = (label) => String(p.notes || "").match(new RegExp(`(?:^|\\n| \\| )${label}:\\s*([^\\n|]+)`, "i"))?.[1].trim() || "";
  const details = {
    date_of_birth: structured ? p.date_of_birth || null : parseDateValue(legacy("Date of birth")) || null,
    facility: structured ? p.facility || "" : legacy("Facility"),
    appointment_time: structured ? p.appointment_time || "" : legacy("Appointment time"),
    contact_person_name: structured ? p.contact_person_name || "" : legacy("Contact person name"),
  };
  const names = details.contact_person_name.split(/\s*\/\s*/).filter(Boolean);
  const aliases = new Set(names);
  const numbers = [];
  const seenNumbers = new Set();
  const addPhones = (text) => {
    for (const number of (importPhones(text) || "").split(" / ").filter(Boolean)) {
      const digits = number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (!seenNumbers.has(digits)) { seenNumbers.add(digits); numbers.push(number); }
    }
  };
  addPhones(p.phone);
  const phonePattern = /(?:\+?1[ .-]*)?(?:\(\d{3}\)|\b\d{3})[ .-]*\d{3}[ .-]*\d{4}\b/g;
  const addNames = (text) => {
    let start = 0;
    let found = false;
    for (const match of text.matchAll(phonePattern)) {
      const candidate = text.slice(start, match.index).trim().replace(/^(?:or|and)\b[\s,:-]*/i, "").replace(/^(?:CG|caregiver)[: -]+/i, "").replace(/\s+(?:dtr|daughter|caregiver)$/i, "").trim();
      start = match.index + match[0].length;
      if (!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3}$/u.test(candidate) || /\b(?:facility|home|homes|health|healthcare|hospital|center|centre|services|inc|care|clinic|office|phone|call|please|requested|prefers|after|before|message|review|results|lab|follow|up|tomorrow|morning|evening|urgent|priority|appointment|scheduled|left)\b/i.test(candidate)) continue;
      const name = candidate.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
      found = true;
      aliases.add(candidate);
      if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase() || existing.toLowerCase().startsWith(name.toLowerCase() + " "))) names.push(name);
    }
    return found;
  };
  const remaining = [];
  for (const part of String(p.notes || "").split(/\r?\n|\s+\|\s+|;\s*/).map((value) => value.trim()).filter(Boolean)) {
    if (details.appointment_time && /^Appointment AM\/PM not specified in source\.?$/i.test(part)) continue;
    if (/^(?:appointment time|facility|date of birth|contact person name|customer person name):/i.test(part)) {
      const value = part.replace(/^[^:]+:\s*/, "");
      if (/^facility:/i.test(part) && !details.facility) details.facility = value;
      if (/^appointment time:/i.test(part) && !details.appointment_time) details.appointment_time = value;
      if (/^date of birth:/i.test(part) && !details.date_of_birth) {
        details.date_of_birth = parseDateValue(value) || null;
        if (!details.date_of_birth) remaining.push(part);
      }
      if (/^(?:contact|customer) person name:/i.test(part) && !names.length) names.push(part.replace(/^[^:]+:\s*/, ""));
      continue;
    }
    const contact = part.replace(/^(?:original\s+)?contact details:\s*/i, "");
    const labelled = contact !== part;
    const hasPhones = Boolean(importPhones(contact));
    const facility = hasPhones && !/\b(?:please|call|requested|prefers|after|before|tomorrow|review)\b/i.test(contact) && /\b(?:home health|healthcare|gem care|care facility|senior homes|hospital|clinic|health center)\b/i.test(contact) ? contact.replace(phonePattern, "").replace(/^[\s#|/-]+|[\s#|/-]+$/g, "") : "";
    const knownDuplicate = part === details.facility || part.replace(/\s/g, "").toLowerCase() === details.appointment_time.replace(/\s/g, "").toLowerCase();
    if (knownDuplicate || part === "#") continue;
    const hasNames = hasPhones && !facility && addNames(contact);
    const barePhones = hasPhones && !contact.replace(phonePattern, "").replace(/\b(?:or|and)\b/gi, "").replace(/[\s/(),.-]/g, "");
    if (labelled || facility || barePhones || hasNames) {
      addPhones(contact);
      if (facility && !details.facility.split(" / ").some((value) => value.toLowerCase() === facility.toLowerCase())) details.facility = [details.facility, facility].filter(Boolean).join(" / ");
      if (facility || barePhones) continue;
      let residue = contact.replace(phonePattern, "");
      for (const name of new Set([...names, ...aliases])) residue = residue.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
      residue = residue.replace(/\b(?:or|and|CG|dtr|daughter|caregiver|facility)\b/gi, "").replace(/^[\s/(),:-]+|[\s/(),:-]+$/g, "").trim();
      if (residue) remaining.push(residue);
    } else remaining.push(part);
  }
  if (/[a-z]/i.test(p.phone || "")) addNames(String(p.phone));
  return { ...details, contact_person_name: names.join(" / "), phone: numbers.join(" / ") || p.phone || "", notes: remaining.join("\n") };
}
function birthDate(value) {
  if (!value) return "--";
  const [year, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}
function patientTable(rows, preview = false, empty = "") {
  const columns = [...(preview ? [["source", "Row", 100]] : []), ...patientColumns, ...(!preview ? [["actions", "Actions", 220]] : [])];
  return `<table class="patient-table${preview ? " bulk-preview-table" : ""}" style="min-width:${columns.reduce((total, column) => total + column[2], 0)}px"><caption class="sr-only">${preview ? "Bulk patient import preview" : "Patient call queue"}</caption><colgroup>${columns.map((column) => `<col style="width:${column[2]}px">`).join("")}</colgroup><thead><tr>${columns.map((column) => `<th scope="col">${column[1]}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => {
    const p = preview ? row.patient : row, values = { ...p, ...patientDetails(p) };
    return `<tr class="${preview ? row.valid ? "" : "import-invalid" : p.id === selectedId ? "active" : ""}">${preview ? `<td>${row.index}${row.valid ? "" : `<span>${escape(row.issues.join(", "))}</span>`}</td>` : ""}${patientColumns.map(([key]) => {
      if (key === "status") return `<td><span class="patient-status ${p.status}">${escape(patientStatus(p))}</span></td>`;
      const value = key === "date_of_birth" ? birthDate(values[key]) : key === "scheduled_date" ? scheduledDate(values[key]) : values[key] || "--";
      return key === "name" ? `<th scope="row">${escape(value)}</th>` : `<td${key === "notes" ? ' class="notes-cell"' : ""}>${escape(value)}</td>`;
    }).join("")}${!preview ? `<td>${patientActions(p)}</td>` : ""}</tr>`;
  }).join("") || `<tr><td colspan="${columns.length}" class="queue-empty">${escape(empty)}</td></tr>`}</tbody></table>`;
}
function formPatientDetails(form) {
  return {
    date_of_birth: form.get("date_of_birth") || null,
    facility: String(form.get("facility") ?? "").trim(),
    appointment_time: String(form.get("appointment_time") ?? "").trim(),
    contact_person_name: String(form.get("contact_person_name") ?? "").trim(),
  };
}
function actionIcon(nodes) {
  const shapes = nodes.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}></${tag}>`).join("");
  return `<svg class="action-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
function patientActions(p) {
  const called = p.status === "called", name = escape(p.name), id = escape(p.id);
  const disabled = busy ? "disabled" : "";
  return `<div class="patient-actions" role="group" aria-label="Actions for ${name}">
    <button type="button" class="patient-action action-edit" data-action="select" data-id="${id}" ${disabled} aria-label="Edit details for ${name}" title="Edit details">${actionIcon(Pencil)}</button>
    <button type="button" class="patient-action ${called ? "action-pending" : "action-called"}" data-action="toggle" data-id="${id}" ${disabled} aria-label="${called ? "Set pending" : "Mark called"} for ${name}" title="${called ? "Set pending" : "Mark called"}">${actionIcon(called ? RotateCcw : PhoneCall)}</button>
    ${called && p.calledAt ? `<button type="button" class="patient-action action-receipt" data-action="receipt" data-id="${id}" ${disabled} aria-label="View receipt for ${name}" title="View receipt">${actionIcon(ReceiptText)}</button>` : ""}
    <button type="button" class="patient-action action-delete" data-action="delete" data-id="${id}" ${disabled} aria-label="Delete ${name}" title="Delete patient">${actionIcon(Trash2)}</button>
  </div>`;
}
function parseDateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const us = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (iso || us) {
    const year = iso ? Number(iso[1]) : Number(us[3].length === 2 ? `20${us[3]}` : us[3]);
    const month = Number(iso ? iso[2] : us[1]), day = Number(iso ? iso[3] : us[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : "";
  }
  if (!/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text)) return "";
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}
function isPhoneValue(value) {
  const text = String(value ?? "").trim();
  return /\d/.test(text) && text.replace(/[^\d]/g, "").length >= 7 && /^[+\d\s()./-]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(text);
}
function importPhones(value) {
  const matches = String(value ?? "").match(/(?:\+?1[ .-]*)?(?:\(\d{3}\)|\b\d{3})[ .-]*\d{3}[ .-]*\d{4}\b/g) || [];
  const seen = new Set();
  return matches.filter((phone) => {
    const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (seen.has(digits)) return false;
    seen.add(digits); return true;
  }).join(" / ");
}
function sheetService(value) {
  const service = String(value ?? "").trim();
  if (/^(?:COGNITIVE(?: ASSESSMENT)?|COG)$/i.test(service)) return "Cognitive assessment";
  if (/^(?:BRAIN MAPPING|BP)$/i.test(service)) return "Brain mapping";
  return "";
}
function importField(name) {
  const key = String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["name", "patient", "patientname", "full", "fullname"].includes(key)) return "name";
  if (["phone", "phonenumber", "mobile", "cell", "contact", "contactnumber", "contactdetails", "telephone"].includes(key)) return "phone";
  if (["reason", "description", "purpose", "service", "concern", "callreason"].includes(key)) return "reason";
  if (["date", "scheduled", "scheduleddate", "appointment", "appointmentdate"].includes(key)) return "scheduled_date";
  if (["note", "notes", "comment", "comments"].includes(key)) return "notes";
  if (["dob", "birthdate", "dateofbirth"].includes(key)) return "date_of_birth";
  if (["appointmenttime", "scheduledtime", "time"].includes(key)) return "appointment_time";
  if (["contactpersonname", "customerpersonname", "contactperson", "caregivername"].includes(key)) return "contact_person_name";
  if (["facility", "agency", "homehealth", "homehealthagency"].includes(key)) return "facility";
  if (["status", "outcome"].includes(key)) return "status";
  return "";
}
function normalizeImportStatus(value) {
  const text = String(value ?? "").toLowerCase();
  if (/^(?:called|done|complete|completed)$/.test(text.trim())) return { status: "called", message_attempts: 0, called_at: new Date().toISOString() };
  if (/twice|message2|^2$/.test(text)) return { status: "pending", message_attempts: 2 };
  if (/message|voicemail|^1$/.test(text)) return { status: "pending", message_attempts: 1 };
  return { status: "pending", message_attempts: 0 };
}
function normalizeImportedPatient(fields, index) {
  const status = normalizeImportStatus(fields.status);
  const patient = {
    id: crypto.randomUUID(),
    name: String(fields.name ?? "").trim(),
    phone: String(fields.phone ?? "").trim(),
    reason: String(fields.reason ?? "").trim(),
    scheduled_date: parseDateValue(fields.scheduled_date) || null,
    date_of_birth: parseDateValue(fields.date_of_birth) || null,
    facility: String(fields.facility ?? "").trim(),
    appointment_time: String(fields.appointment_time ?? "").trim(),
    contact_person_name: String(fields.contact_person_name ?? "").trim(),
    notes: String(fields.notes ?? "").trim(),
    ...status,
  };
  const issues = [];
  Object.assign(patient, patientDetails(patient));
  if (!patient.name) issues.push("Name missing");
  if (!patient.phone) issues.push("Phone missing");
  if (!patient.reason) issues.push("Description missing");
  if (fields.scheduled_date && !patient.scheduled_date) issues.push("Date not recognized");
  if (fields.date_of_birth && !patient.date_of_birth) issues.push("Date of birth not recognized");
  if (fields.importError) issues.push(fields.importError);
  return { index, patient, valid: issues.length === 0, issues };
}
function parseBulkPatients(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  if (!source.trim()) return [];
  const tableLines = source.split(/\r?\n/).map((line) => line.trim().replace(/^["“](?=\s*\|)/, "").replace(/(\|)\s*["”]$/, "$1")).filter((line) => line && !/^["“”]$|^```(?:[a-z]+)?$/i.test(line));
  const markdown = tableLines.length > 0 && tableLines.every((line) => /^\|.*\|$/.test(line));
  const parsed = Papa.parse(markdown ? tableLines.join("\n") : source, {
    skipEmptyLines: "greedy",
    ...(markdown ? { delimiter: "|", quoteChar: "\0" } : { delimitersToGuess: ["\t", ",", ";", "|"] }),
    transform: (cell) => markdown ? cell.trim().replace(/^(\*\*|__)([\s\S]*?)\1["”]?$/, "$2").trim() : cell.trim(),
  });
  let rows = parsed.data.filter((row) => row.some(Boolean));
  if (markdown) {
    // Remove table borders and alignment rows, keeping empty cells in their original columns.
    rows = rows.map((row) => row.slice(1, -1)).filter((row) => row.some(Boolean) && !row.every((cell) => !cell || /^:?-+:?$/.test(cell)));
  }
  if (!rows.length) return [];
  if (rows.every((row) => row.length === 1) && !source.includes('"')) {
    rows = rows.map(([line]) => line.split(/\s{2,}| - /).map((cell) => cell.trim()));
  }
  const header = rows[0].map(importField);
  const hasHeader = header.includes("name") && header.filter(Boolean).length >= 2;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const clinicSheet = !hasHeader && dataRows.some((row) => sheetService(row[1]));
  const records = [];
  dataRows.forEach((row, index) => {
    if (clinicSheet && !sheetService(row[1]) && row.slice(1).every((cell) => !cell || cell === "#")) {
      const previous = records.at(-1);
      if (previous) {
        previous.fields.notes = [previous.fields.notes, row[0]].filter(Boolean).join("\n");
        if (!previous.fields.phone) previous.fields.phone = importPhones(row[0]);
      } else records.push({ index: index + 1, fields: { name: row[0], importError: "Contact details have no preceding patient" } });
      return;
    }
    const fields = {};
    if (hasHeader) {
      const extras = [];
      row.forEach((cell, cellIndex) => {
        if (header[cellIndex]) fields[header[cellIndex]] = cell;
        else if (cell) extras.push(`${rows[0][cellIndex] || "Additional details"}: ${cell}`);
      });
      fields.notes = [fields.notes, ...extras].filter(Boolean).join("\n");
    } else if (clinicSheet) {
      const name = row[0] || "";
      const appointment = name.match(/\s+(?:COG|BP)\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*$/i);
      fields.name = appointment ? name.slice(0, appointment.index).trim() : name;
      fields.reason = sheetService(row[1]) || row[1];
      fields.date_of_birth = row[2];
      fields.appointment_time = appointment?.[1] || "";
      const facility = row[5] || "", facilityPhones = importPhones(facility);
      fields.phone = [importPhones(row[3]), facilityPhones].filter(Boolean).join(" / ");
      fields.facility = facilityPhones.split(" / ").filter(Boolean).reduce((name, phone) => name.replaceAll(phone, ""), facility).replace(/^[\s/]+|[\s/]+$/g, "");
      fields.notes = [row[3] ? `Contact details: ${row[3]}` : "", row[4], ...row.slice(6)].filter(Boolean).join("\n");
    } else {
      const extras = [];
      for (const cell of row) {
        if (!cell) continue;
        if (!fields.scheduled_date && parseDateValue(cell)) fields.scheduled_date = cell;
        else if (!fields.phone && isPhoneValue(cell)) fields.phone = cell;
        else if (!fields.status && /^(?:called|done|complete|completed|pending|left message(?: twice)?|voicemail)$/i.test(cell)) fields.status = cell;
        else if (!fields.name) fields.name = cell;
        else if (!fields.reason) fields.reason = cell;
        else extras.push(cell);
      }
      if (extras.length) fields.notes = extras.join(" | ");
    }
    records.push({ fields, index: index + 1 });
  });
  const malformed = parsed.errors.some((error) => error.type === "Quotes");
  return records.map(({ fields, index }) => normalizeImportedPatient({ ...fields, ...(malformed ? { importError: "CSV quotation error; check the source data" } : {}) }, index));
}
function updateBulkImport() {
  bulkFileRead += 1;
  $("bulkImportMessage").hidden = true;
  bulkImportRows = parseBulkPatients($("bulkPatientInput").value);
  render();
}
function renderBulkImport() {
  const total = bulkImportRows.length, ready = bulkImportRows.filter((row) => row.valid).length;
  $("bulkImportCount").textContent = total ? `${ready} of ${total} patients ready` : "No patients detected";
  $("bulkImportButton").disabled = busy || !dataReady || !user || !ready;
  $("bulkImportPreview").innerHTML = total ? patientTable(bulkImportRows, true) : "";
}
function dateTime(p) {
  const d = new Date(p.calledAt);
  return { date: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) };
}
function callFor(p) { return calls.find((c) => c.patient_id === p?.id && new Date(c.called_at).getTime() === new Date(p.calledAt).getTime()); }
function receiptForPatient(p) { return receipts.find((r) => r.id === callFor(p)?.id); }
function receiptNumber(p) { return receiptForPatient(p)?.receipt_number || `BS-${p.calledAt.slice(0, 10).replaceAll("-", "")}-${p.id.slice(0, 6).toUpperCase()}`; }
function render() {
  if (!patients.some((p) => p.id === selectedId)) selectedId = patients[0]?.id;
  const pending = patients.filter((p) => p.status === "pending").length;
  $("pendingCount").textContent = pending;
  $("calledCount").textContent = patients.length - pending;
  $("receiptCount").textContent = receipts.length;
  $("doctorName").textContent = doctor.name;
  $("doctorSpecialty").textContent = doctor.specialty;
  $("doctorRegistration").textContent = doctor.registration;
  $("doctorClinic").textContent = doctor.clinic;
  $("editProfile").disabled = busy;
  for (const e of $("doctorForm").elements) e.disabled = busy || !user;
  $("cancelProfile").disabled = busy;
  $("closeProfile").disabled = busy;
  $("updateProfile").textContent = busy ? "Saving..." : "Update Profile";
  for (const field of $("editPatientForm").elements) field.disabled = busy || !user;
  $("cancelPatient").disabled = busy;
  $("closePatient").disabled = busy;
  $("cancelDeletePatient").disabled = $("confirmDeletePatient").disabled = busy;
  $("confirmDeletePatient").textContent = busy && $("deletePatientDialog").open ? "Deleting..." : "Delete patient";
  $("activeQueueLabel").textContent = `${pending} waiting`;
  const query = $("patientSearch").value.trim().toLowerCase(), filter = $("statusFilter").value;
  const visible = patients.filter((p) => (filter === "all" || (filter === "message" ? p.status === "pending" && p.message_attempts > 0 : p.status === filter)) && [p.name, p.phone, p.reason, p.notes, ...Object.values(patientDetails(p))].some((value) => String(value ?? "").toLowerCase().includes(query)));
  $("resultCount").textContent = `${visible.length} of ${patients.length} patients`;
  $("patientList").innerHTML = patientTable(visible, false, patients.length ? "No patients match your search." : "No patients in your queue.");
  $("callNext").disabled = busy || !dataReady || !pending;
  $("loginForm").hidden = !configured || Boolean(user);
  $("signOut").hidden = !user;
  for (const e of $("patientForm").elements) e.disabled = busy || !dataReady || !user;
  for (const e of $("bulkImportForm").elements) e.disabled = busy || !dataReady || !user;
  $("patientAccess").hidden = Boolean(user && dataReady && !busy);
  $("patientAccessMessage").textContent = !configured ? "Supabase is not configured." : !user ? "Sign in to add patients." : busy ? "Connecting or saving..." : "Patient data could not be loaded.";
  $("patientSignIn").hidden = !configured || Boolean(user);
  $("retryConnection").hidden = !user || dataReady || busy;
  renderBulkImport();
  const p = selected(), completed = p?.status === "called" && Boolean(p.calledAt);
  const receiptKey = completed ? `${p.id}:${p.calledAt}` : null;
  if (receiptFor !== receiptKey) {
    $("receiptFile").hidden = true;
    if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    receiptUrl = null; receiptFor = receiptKey;
  }
  const stamp = completed ? dateTime(p) : { date: "--", time: "--" };
  const provider = callFor(p)?.doctor_snapshot || doctor;
  const snapshot = callFor(p)?.patient_snapshot || p;
  const values = { receiptStatus: completed ? "Receipt ready" : "Complete call first", receiptNumber: completed ? receiptNumber(p) : "No completed call selected", receiptBadge: completed ? "Completed" : "Pending", receiptDoctor: provider.name, receiptSpecialty: provider.specialty, receiptPatient: p?.name || "Select patient", receiptPhone: p?.phone || "--", receiptDate: stamp.date, receiptTime: stamp.time, receiptReason: p?.reason || "--", receiptOutcome: completed ? "Call completed and logged" : "Awaiting completed call", receiptSummary: completed ? `This receipt records a completed call with ${p.name} concerning ${p.reason.toLowerCase()}.` : "No completed call recorded." };
  for (const [id, value] of Object.entries(values)) $(id).textContent = value;
  $("receiptScheduledDate").textContent = scheduledDate(snapshot?.scheduled_date);
  $("receiptNotes").textContent = snapshot?.notes || "--";
  const details = patientDetails(snapshot || {});
  $("receiptBirthDate").textContent = birthDate(details.date_of_birth);
  $("receiptFacility").textContent = details.facility || "--";
  $("receiptAppointmentTime").textContent = details.appointment_time || "--";
  $("receiptContactPerson").textContent = details.contact_person_name || "--";
  $("receiptNotes").textContent = details.notes || "--";
  if (completed) {
    $("receiptPatient").textContent = snapshot.name;
    $("receiptPhone").textContent = snapshot.phone;
    $("receiptReason").textContent = snapshot.reason;
    $("receiptSummary").textContent = `This receipt records a completed call with ${snapshot.name} concerning ${snapshot.reason.toLowerCase()}.`;
  }
  $("downloadReceipt").disabled = $("shareReceipt").disabled = !completed || busy;
}
async function action(fn) {
  if (busy) return;
  busy = true; render();
  try { await fn(); }
  catch (error) {
    const text = error.code === "PGRST204" || error.code === "42703" ? "New patient fields need database setup. Run supabase/patient-details.sql in Supabase SQL Editor, then retry." : error.code === "PGRST205" || error.code === "42P01" ? "Database setup is incomplete. Run supabase/schema.sql in your Supabase SQL Editor, then sign in again." : error.message || "The action failed. Please try again.";
    message(text);
    if ($("profileDialog").open) { $("profileMessage").textContent = text; $("profileMessage").hidden = false; }
    if ($("receiptDialog").open) { $("receiptMessage").textContent = text; $("receiptMessage").hidden = false; }
    if ($("patientDialog").open) { $("patientMessage").textContent = text; $("patientMessage").hidden = false; }
    if ($("deletePatientDialog").open) { $("deletePatientMessage").textContent = text; $("deletePatientMessage").hidden = false; }
    if (document.activeElement?.closest?.("#bulkImportForm")) { $("bulkImportMessage").textContent = text; $("bulkImportMessage").hidden = false; }
  }
  finally { busy = false; render(); }
}
async function refresh() {
  dataReady = false;
  const profile = await supabase.from("doctor_profiles").select("*").eq("id", user.id).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) {
    const { error } = await supabase.from("doctor_profiles").insert({ id: user.id, ...doctor });
    if (error) throw error;
  } else {
    const { id, ...fields } = profile.data;
    Object.assign(doctor, fields);
  }
  if (!$("profileDialog").open) fillProfileForm();
  const results = await Promise.all([
    supabase.from("patients").select("*").order("created_at", { ascending: false }),
    supabase.from("calls").select("*").order("called_at", { ascending: false }),
    supabase.from("call_receipts").select("*").order("created_at", { ascending: false }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  patients = results[0].data.map(({ called_at, ...p }) => ({ ...p, calledAt: called_at }));
  calls = results[1].data; receipts = results[2].data; dataReady = true; render();
}
async function markPatient(p) {
  if (!supabase || !user) throw new Error("Sign in to save patient calls to Supabase.");
  const status = p.status === "called" ? "pending" : "called", calledAt = status === "called" ? new Date().toISOString() : null;
  if (supabase) {
    const { data, error } = await supabase.from("patients").update({ status, called_at: calledAt, message_attempts: 0 }).eq("id", p.id).select().single();
    if (error) throw error;
    Object.assign(p, data, { calledAt: data.called_at });
    selectedId = p.id;
    await refresh();
    if (status === "called") {
      try { await cloudPdf(p); message("Call and receipt saved to Supabase."); }
      catch (error) { throw new Error(`Call saved, but PDF upload failed: ${error.message}. Use Download PDF to retry.`); }
    } else message("Patient marked pending. Previous calls and receipts remain saved.");
  }
  selectedId = p.id;
}
async function deletePatient(id) {
  if (!supabase || !user) throw new Error("Sign in to delete patient records.");
  const patient = patients.find((p) => p.id === id);
  if (!patient) throw new Error("This patient is no longer in the queue. Refresh and try again.");
  const { data, error } = await supabase.from("patients").delete().eq("id", id).eq("doctor_id", user.id).select("id").maybeSingle();
  if (error?.code === "23503") throw new Error("This patient has saved call history and cannot be deleted. The patient record has been kept.");
  if (error) throw error;
  if (!data) throw new Error("The patient could not be deleted. Refresh the queue and try again.");
  patients = patients.filter((p) => p.id !== id);
  if (selectedId === id) selectedId = null;
  if (editingId === id) { editingId = null; $("patientDialog").close(); }
  deletingId = null;
  $("deletePatientDialog").close();
  message(`${patient.name} was deleted.`);
}
$("patientSignIn").addEventListener("click", () => {
  $("loginForm").elements.namedItem("email").focus();
});
$("retryConnection").addEventListener("click", () => action(async () => {
  await refresh(); message("Patient queue connected.");
}));
$("patientList").addEventListener("click", (event) => {
  const b = event.target.closest("button[data-action]"); if (!b) return;
  const p = patients.find((p) => p.id === b.dataset.id); if (!p) return;
  if (b.dataset.action === "toggle") action(() => markPatient(p));
  else {
    if (busy) return;
    selectedId = p.id; render();
    if (b.dataset.action === "delete") {
      deletingId = p.id;
      $("deletePatientName").textContent = p.name;
      $("deletePatientMessage").hidden = true;
      $("deletePatientDialog").showModal();
    } else if (b.dataset.action === "receipt") {
      $("receiptMessage").hidden = true;
      $("receiptDialog").showModal();
    } else {
      editingId = p.id;
      const values = { ...p, ...patientDetails(p) };
      for (const field of $("editPatientForm").elements) if (field.name) field.value = field.name === "outcome" ? p.status === "called" ? "called" : p.message_attempts >= 2 ? "message2" : p.message_attempts === 1 ? "message1" : "pending" : values[field.name] || "";
      $("patientMessage").hidden = true;
      $("patientDialog").showModal();
    }
  }
});
$("patientSearch").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("cancelDeletePatient").addEventListener("click", () => {
  if (busy) return;
  deletingId = null;
  $("deletePatientDialog").close();
});
$("deletePatientDialog").addEventListener("cancel", (event) => {
  if (busy) event.preventDefault();
  else deletingId = null;
});
$("deletePatientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!deletingId) return;
  const id = deletingId;
  $("deletePatientMessage").hidden = true;
  return action(() => deletePatient(id));
});
for (const [dialogId, closeId] of [["receiptDialog", "closeReceipt"], ["patientDialog", "closePatient"]]) {
  const dialog = $(dialogId);
  $(closeId).addEventListener("click", () => { if (!busy || dialogId === "receiptDialog") dialog.close(); });
  dialog.addEventListener("cancel", (event) => { if (busy && dialogId === "patientDialog") event.preventDefault(); });
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if ((!busy || dialogId === "receiptDialog") && event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
}
$("callNext").addEventListener("click", () => action(async () => { const p = patients.find((p) => p.status === "pending"); if (p) await markPatient(p); }));
$("cancelPatient").addEventListener("click", () => { if (!busy) $("patientDialog").close(); });
$("editPatientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget), id = editingId;
  const p = patients.find((patient) => patient.id === id);
  if (!p) return;
  const outcome = form.get("outcome"), status = outcome === "called" ? "called" : "pending";
  const update = { name: String(form.get("name") ?? "").trim(), phone: String(form.get("phone") ?? "").trim(), reason: String(form.get("reason") ?? "").trim(), scheduled_date: form.get("scheduled_date") || null, notes: String(form.get("notes") ?? "").trim(), message_attempts: outcome === "message2" ? 2 : outcome === "message1" ? 1 : 0, status, called_at: status === "called" ? p.calledAt || new Date().toISOString() : null };
  Object.assign(update, formPatientDetails(form));
  Object.assign(update, patientDetails(update));
  $("patientMessage").hidden = true;
  return action(async () => {
    if (!user || !supabase) throw new Error("Sign in to update patients.");
    if (!update.name || !update.phone || !update.reason) throw new Error("Enter the patient name, phone number and description.");
    const { error } = await supabase.from("patients").update(update).eq("id", id);
    if (error) throw error;
    await refresh();
    $("patientDialog").close();
    message("Patient details saved to Supabase.");
  });
});
$("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  // Disabled fields are excluded from FormData, so capture before action() renders.
  const f = new FormData(form);
  return action(async () => {
    if (!supabase || !user) throw new Error("Sign in to save patients to Supabase.");
    const p = { id: crypto.randomUUID(), name: String(f.get("patientName") ?? "").trim(), phone: String(f.get("patientPhone") ?? "").trim(), reason: String(f.get("patientReason") ?? "").trim(), scheduled_date: f.get("scheduled_date") || null, notes: String(f.get("notes") ?? "").trim(), message_attempts: 0, status: "pending" };
    Object.assign(p, formPatientDetails(f));
    Object.assign(p, patientDetails(p));
    if (!p.name || !p.phone) throw new Error("Enter a patient name and phone number.");
    if (!p.reason) throw new Error("Select a reason for the call.");
    if (supabase) { const { error } = await supabase.from("patients").insert({ ...p, doctor_id: user.id }); if (error) throw error; }
    patients.unshift(p); selectedId = p.id; form.reset(); message("Patient saved to Supabase.");
  });
});
$("bulkPatientInput").addEventListener("input", updateBulkImport);
$("bulkImportFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  const request = ++bulkFileRead;
  if (!file) return;
  try {
    const text = await file.text();
    if (request !== bulkFileRead) return;
    $("bulkPatientInput").value = text;
    updateBulkImport();
  } catch {
    if (request !== bulkFileRead) return;
    $("bulkImportMessage").textContent = "Could not read this file. Select the CSV again.";
    $("bulkImportMessage").hidden = false;
  }
});
$("clearBulkImport").addEventListener("click", () => {
  $("bulkPatientInput").value = "";
  $("bulkImportFile").value = "";
  $("bulkImportMessage").hidden = true;
  updateBulkImport();
});
$("bulkImportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const rows = bulkImportRows.filter((row) => row.valid).map((row) => row.patient);
  $("bulkImportMessage").hidden = true;
  return action(async () => {
    if (!supabase || !user) throw new Error("Sign in to import patients to Supabase.");
    if (!rows.length) throw new Error("Paste at least one valid patient row.");
    const records = rows.map((patient) => ({ ...patient, doctor_id: user.id }));
    const { error } = await supabase.from("patients").insert(records);
    if (error) throw error;
    selectedId = rows[0].id;
    $("bulkPatientInput").value = "";
    $("bulkImportFile").value = "";
    bulkFileRead += 1;
    bulkImportRows = [];
    await refresh();
    message(`${rows.length} patient${rows.length === 1 ? "" : "s"} imported to Supabase.`);
  });
});
async function pdfFile() {
  const p = selected(); if (!p || p.status !== "called" || !p.calledAt) throw new Error("Select a completed call.");
  if (!supabase || !user) throw new Error("Sign in to access saved receipts.");
  return cloudPdf(p);
}
async function cloudPdf(p) {
  const call = callFor(p), receipt = receiptForPatient(p);
  if (!call || !receipt) throw new Error("Call receipt record is missing. Check the database setup.");
  const path = `${user.id}/${receipt.id}.pdf`;
  const storage = supabase.storage.from("call-receipts");
  let blob;
  if (receipt.storage_path) {
    const result = await storage.download(receipt.storage_path);
    if (result.error) throw result.error;
    blob = result.data;
  } else {
    const snapshot = { ...call.patient_snapshot, calledAt: call.called_at };
    blob = await createReceiptPdf({ ...snapshot, ...patientDetails(snapshot) }, call.doctor_snapshot, dateTime(snapshot), receipt.receipt_number);
    const uploaded = await storage.upload(path, blob, { contentType: "application/pdf", upsert: false });
    if (uploaded.error) {
      // A previous upload may have succeeded while its database update failed.
      if (String(uploaded.error.statusCode) !== "409") throw uploaded.error;
      const existing = await storage.download(path);
      if (existing.error) throw existing.error;
      blob = existing.data;
    }
    const saved = await supabase.from("call_receipts").update({ storage_path: path }).eq("id", receipt.id).select().single();
    if (saved.error) throw saved.error;
    Object.assign(receipt, saved.data);
  }
  return new File([blob], `${receipt.receipt_number}.pdf`, { type: "application/pdf" });
}
function fillProfileForm() {
  for (const field of $("doctorForm").elements) if (field.name) field.value = doctor[field.name] || "";
}
$("editProfile").addEventListener("click", () => {
  fillProfileForm();
  $("profileMessage").hidden = Boolean(user);
  $("profileMessage").textContent = user ? "" : "Sign in to update your doctor profile.";
  $("profileDialog").showModal();
});
function closeProfile() { if (!busy) $("profileDialog").close(); }
$("closeProfile").addEventListener("click", closeProfile);
$("cancelProfile").addEventListener("click", closeProfile);
$("profileDialog").addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
$("profileDialog").addEventListener("click", (event) => {
  const rect = $("profileDialog").getBoundingClientRect();
  if (event.target === $("profileDialog") && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeProfile();
});
$("doctorForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const profile = Object.fromEntries([...form].map(([name, value]) => [name, String(value).trim()]));
  $("profileMessage").hidden = true;
  action(async () => {
    if (!supabase || !user) throw new Error("Sign in to update your doctor profile.");
    if (!profile.name || !profile.specialty || !profile.clinic || !profile.address || !profile.email) throw new Error("Complete your doctor details.");
    const { error } = await supabase.from("doctor_profiles").upsert({ id: user.id, ...profile });
    if (error) throw error;
    Object.assign(doctor, profile); $("profileDialog").close(); message("Doctor profile saved to Supabase.");
  });
});
function download(file) {
  if (receiptUrl) URL.revokeObjectURL(receiptUrl);
  const url = URL.createObjectURL(file), a = document.createElement("a");
  receiptUrl = url;
  $("receiptFile").href = url; $("receiptFile").hidden = false;
  a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
}
$("downloadReceipt").addEventListener("click", () => action(async () => { download(await pdfFile()); message("Receipt PDF prepared for download."); }));
$("shareReceipt").addEventListener("click", () => action(async () => {
  const file = await pdfFile();
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Call Receipt" }); } catch (e) { if (e.name !== "AbortError") throw e; }
  } else { download(file); message("Receipt downloaded. Attach the PDF to your email or message."); }
}));
$("loginForm").addEventListener("submit", (event) => {
  event.preventDefault(); action(async () => {
    const f = new FormData(event.target);
    const { data, error } = await supabase.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
    if (error) throw error;
    user = data.user; event.target.reset(); await refresh(); message("Signed in.");
  });
});
$("signOut").addEventListener("click", () => action(async () => {
  const { error } = await supabase.auth.signOut(); if (error) throw error;
  user = null; patients = []; calls = []; receipts = []; dataReady = false; message("Signed out.");
}));
if (supabase) supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    $("profileDialog").close();
    $("receiptDialog").close();
    $("patientDialog").close();
    $("deletePatientDialog").close();
    deletingId = null;
    Object.assign(doctor, defaultDoctor);
    user = null; patients = []; calls = []; receipts = []; dataReady = false; render();
    message("Sign in to access your patient queue.");
  }
});
render();
if (supabase) action(async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  user = data.user;
  if (user) { await refresh(); message("Patient queue connected."); }
  else message("Sign in to access your patient queue.");
});
else message("Supabase configuration is missing. Update .env and restart the portal.");
