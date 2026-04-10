// Material categories and color coding system
// HAVE = warm tones (reds, oranges)
// NEED = cool tones (blues, greens)
// 4 main categories control the pin color on the map
// Subcategories provide detail in the form and listing

window.CATEGORIES = {
  fill_soil: {
    label: 'Fill / Soil',
    haveColor: '#e74c3c',    // red
    needColor: '#2980b9',    // blue
    subcategories: {
      clean_fill:     { label: 'Clean Fill',     description: 'Uncontaminated soil suitable for general fill' },
      topsoil:        { label: 'Topsoil',        description: 'Nutrient-rich surface soil for landscaping' },
      screened_fill:  { label: 'Screened Fill',   description: 'Processed soil screened free of debris and rocks' },
      structural_fill:{ label: 'Structural Fill', description: 'Engineered compactable material for load-bearing areas' },
      clay:           { label: 'Clay',            description: 'Clay material for liners, capping, or fill' }
    }
  },
  aggregate: {
    label: 'Aggregate',
    haveColor: '#e67e22',
    needColor: '#3498db',    // light blue
    subcategories: {
      concrete_crush:   { label: 'Concrete Crush',        description: 'Recycled crushed concrete aggregate' },
      asphalt_millings: { label: 'Asphalt Millings',      description: 'Recycled ground asphalt, good for base/driveways' },
      gravel:           { label: 'Gravel / Crushed Stone', description: 'Drainage material, base course aggregate' },
      sand:             { label: 'Sand',                   description: 'Bedding sand, backfill, concrete mix sand' }
    }
  },
  organic: {
    label: 'Organic',
    haveColor: '#27ae60',    // green
    needColor: '#9b59b6',    // purple
    subcategories: {
      organic_material: { label: 'Organic Material', description: 'Compost, mulch, organic soil matter' }
    }
  },
  rock_rubble: {
    label: 'Rock & Rubble',
    haveColor: '#d35400',    // dark orange
    needColor: '#2c3e50',    // dark navy
    subcategories: {
      rock_boulders:     { label: 'Rock / Boulders',   description: 'Large rock, rip-rap, erosion control material' },
      demolition_rubble: { label: 'Demolition Rubble', description: 'Mixed demolition material (may require special handling)' }
    }
  }
};

// Build a flat lookup: material_type key -> { label, description, category key, category label, haveColor, needColor }
window.MATERIALS = {};
Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
  Object.entries(cat.subcategories).forEach(([subKey, sub]) => {
    MATERIALS[subKey] = {
      label: sub.label,
      description: sub.description,
      category: catKey,
      categoryLabel: cat.label,
      haveColor: cat.haveColor,
      needColor: cat.needColor
    };
  });
});

// Helper to get color for a pin (uses category color)
window.getPinColor = function(pinType, materialType) {
  const mat = MATERIALS[materialType];
  if (!mat) return pinType === 'have' ? '#e74c3c' : '#2980b9';
  return pinType === 'have' ? mat.haveColor : mat.needColor;
};
