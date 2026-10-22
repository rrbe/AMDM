export const jsonFormatExamples = Array.from({ length: 8 }, (_, index) => ({
  _id: { $oid: `507f1f77bcf86cd7994390${11 + index}` },
  createdAt: { $date: { $numberLong: String(1767225600000 + index * 86400000) } },
  count: { $numberLong: String(42 + index) }
}))
