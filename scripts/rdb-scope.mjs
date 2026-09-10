// Match the exact application namespace as bytes, before decoding any values.
// Other projects may contain binary data; they must not enter PULSE recovery.
const pulsePrefix = Buffer.from("pulse:");
export function selectPulseRecords(records) {
  return records.filter(record => record.key.subarray(0, pulsePrefix.length).equals(pulsePrefix));
}
