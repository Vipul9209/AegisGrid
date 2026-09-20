// Red-cell compatibility: recipient group -> donor groups, best match first.
export const RBC_DONORS = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

export function donorRank(recipient, donor) {
  const list = RBC_DONORS[recipient] ?? RBC_DONORS['O-'];
  const i = list.indexOf(donor);
  return i; // -1 = incompatible, 0 = exact match
}
