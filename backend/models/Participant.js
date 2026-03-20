const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    first_name:       { type: String, default: '', trim: true },
    last_name:        { type: String, default: '', trim: true },
    participant_name: { type: String, default: '' },
    company:          { type: String, required: true },
    department:       { type: String, required: true },
    training_type: {
      type: String,
      required: true,
      enum: [
        'Dispatch Graduate', 'Human Factors', 'Recurrent',
        'FDI', 'FDR', 'FDA', 'FTL', 'NDG', 'HF', 'GD', 'TCD'
      ]
    },
    airline_name: { type: String, default: null },
    submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Airline', default: null },
    locked:       { type: Boolean, default: true },
    training_date: { type: String, required: true },
    end_date:      { type: String, default: null },
    location:      { type: String, default: null },   // ← NEW: training location
    modules:       { type: String, default: null },

    // ── Certificate sequence number ────────────────────────────────────────────
    cert_sequence: { type: Number, default: null },

    // ── Template variant ───────────────────────────────────────────────────────
    // 'default' = IFOA green template, 'india' = IFOA INDIA orange template
    // Saved on first generation so preview/download always uses the same template.
    templateVariant: { type: String, default: 'default', enum: ['default', 'india'] },
    cert_year_override: { type: Number, default: null }, // override year in cert ID
    ndg_score:   { type: Number, default: null, min: 0, max: 100 }, // NDG exam score (0-100)
    ndg_subtype: { type: String, default: 'I', enum: ['I', 'R'] },   // I = Initial, R = Recurrent
    online_synchronous: { type: Boolean, default: false },            // replaces location with 'Online Synchronous'
    cert_validity: { type: String, default: '36', enum: ['12', '24', '36', 'Unlimited'] }, // months or Unlimited
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// NO pre-save hook — participant_name is set explicitly in the route
module.exports = mongoose.model('Participant', participantSchema);
