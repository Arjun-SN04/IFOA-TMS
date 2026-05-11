const mongoose = require('mongoose');

const attendanceSheetSchema = new mongoose.Schema(
  {
    company:       { type: String, required: true },
    training_type: { type: String, default: null },
    start_date:    { type: String, required: true },   // YYYY-MM-DD
    end_date:      { type: String, default: null },    // YYYY-MM-DD
    participants: [{ first_name: String, last_name: String }],
    records: [{
      date:    { type: String },        // YYYY-MM-DD
      present: { type: [Number] },      // indices of present participants
    }],
    submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Airline', default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => { ret.id = ret._id; delete ret.__v; return ret; },
    },
  }
);

module.exports = mongoose.model('AttendanceSheet', attendanceSheetSchema);
