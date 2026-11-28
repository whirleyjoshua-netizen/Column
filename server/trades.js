// Trades: ready-made kinds of job for businesses that do work at a customer's place (HVAC, installers, lawn care…).
// Each trade is a list in a Jobs project: the details that trade writes down, its checklist, and the stages its
// jobs go through. Every job also gets the same core: the customer (a contact), where, when, who, what it's worth,
// how to get in, photos before and after, and the customer's sign-off.
const COLORS = ['gray', 'blue', 'violet', 'amber', 'teal', 'rose', 'green'];
const choices = (labels) => labels.map((label, i) => ({ label, color: COLORS[Math.min(i, COLORS.length - 1)] }));

// How a family of trades moves a job along.
export const FAMILIES = {
  service: { name: 'Repair and service', about: 'Something’s broken or due for a service', stages: ['New', 'Scheduled', 'In progress', 'Waiting on parts', 'Done', 'Invoiced', 'Paid'] },
  install: { name: 'Installers', about: 'Measure, order, install', stages: ['Lead', 'Measure booked', 'Measured', 'Quoted', 'Ordered', 'Scheduled', 'Installed', 'Invoiced', 'Paid'] },
  project: { name: 'Remodel and building', about: 'Multi-day projects, often with permits', stages: ['Estimate', 'Approved', 'Permit', 'In progress', 'Inspection', 'Punch list', 'Complete', 'Paid'] },
  recurring: { name: 'Recurring outdoor and home services', about: 'The same customers every week or month', stages: ['Scheduled', 'Done', 'Skipped', 'Invoiced', 'Paid'] },
  cleaning: { name: 'Cleaning, restoration and hauling', about: 'Cleans, damage jobs, junk and moves', stages: ['New', 'Scheduled', 'In progress', 'Done', 'Invoiced', 'Paid'] },
  mobile: { name: 'Mobile and specialty services', about: 'You go to the customer: towing, deliveries, cars, pets, inspections', stages: ['Booked', 'On the way', 'In progress', 'Done', 'Paid'] },
};

// Field shorthands: [key, name, type, extra].
const t = (key, name) => [key, name, 'text'];
const n = (key, name) => [key, name, 'number'];
const d = (key, name) => [key, name, 'date'];
const yes = (key, name) => [key, name, 'checkbox'];
const one = (key, name, labels) => [key, name, 'select', { choices: choices(labels) }];
const many = (key, name, labels) => [key, name, 'multi', { choices: choices(labels) }];
const equipment = (name = 'Equipment') => ['equipment', name, 'equipment'];
const windows = (name = 'Measurements', unit = 'in') => ['measurements', name, 'measure', { mode: 'wh', unit }];
const areas = (name = 'Areas', unit = 'ft') => ['measurements', name, 'measure', { mode: 'area', unit }];
const lengths = (name = 'Runs', unit = 'ft') => ['measurements', name, 'measure', { mode: 'length', unit }];
const materials = (name = 'Materials') => ['materials', name, 'materials'];
const readings = (list, name = 'Readings') => ['readings', name, 'readings', { list }];
const permit = () => ['permit', 'Permit', 'permit'];
const often = () => one('frequency', 'How often', ['Weekly', 'Every 2 weeks', 'Monthly', 'Quarterly', 'Twice a year', 'Once']);

// The trades. `fields` are what this trade writes down; `checklist` is what gets done on site.
export const TRADES = {
  // ----- repair and service -----
  hvac: { family: 'service', name: 'HVAC', icon: '❄️', job: 'HVAC job', fields: [
    one('kind', 'Kind of job', ['Repair', 'Maintenance', 'Install', 'Estimate']), one('system', 'System', ['Central AC', 'Heat pump', 'Furnace', 'Boiler', 'Mini-split', 'Package unit', 'Rooftop unit']),
    equipment(), t('filter', 'Filter size'), one('refrigerant', 'Refrigerant', ['R-410A', 'R-454B', 'R-32', 'R-22', 'Other']), t('problem', 'What’s wrong'),
    readings(['Supply temp °F', 'Return temp °F', 'Suction pressure psi', 'Head pressure psi', 'Superheat °F', 'Subcool °F', 'Amp draw A']), materials('Parts used')],
    checklist: ['Talk to the customer about the problem', 'Check thermostat and breakers', 'Inspect the equipment', 'Replace the filter', 'Fix the problem', 'Test heating and cooling', 'Record readings', 'Photos of the equipment and label', 'Walk the customer through what was done'] },
  plumbing: { family: 'service', name: 'Plumbing', icon: '🚰', job: 'Plumbing job', fields: [
    one('kind', 'Kind of job', ['Leak', 'Clog', 'Water heater', 'Fixture', 'Repipe', 'Sewer line', 'Estimate']), t('location', 'Where in the house'), t('fixture', 'Fixture or line'),
    equipment('Water heater / equipment'), t('shutoff', 'Main shutoff location'), t('problem', 'What’s wrong'), materials('Parts used')],
    checklist: ['Find the shutoff', 'Protect floors', 'Diagnose', 'Repair', 'Pressure test / check for leaks', 'Clean up', 'Photos before and after', 'Show the customer'] },
  electrical: { family: 'service', name: 'Electrical', icon: '⚡', job: 'Electrical job', fields: [
    one('kind', 'Kind of job', ['Repair', 'Panel upgrade', 'New circuit', 'Lighting', 'EV charger', 'Generator hookup', 'Inspection']), t('panel', 'Panel (brand, amps)'),
    n('circuits', 'Circuits'), t('problem', 'What’s wrong'), permit(), materials('Parts used')],
    checklist: ['Turn off and lock out the circuit', 'Verify it’s dead', 'Do the work', 'Label the panel', 'Test every circuit touched', 'Photos of the panel', 'Book the inspection if needed'] },
  appliance: { family: 'service', name: 'Appliance repair', icon: '🧺', job: 'Appliance repair', fields: [
    one('appliance', 'Appliance', ['Refrigerator', 'Washer', 'Dryer', 'Dishwasher', 'Oven / range', 'Microwave', 'Ice maker', 'Other']), equipment('Appliance details'),
    t('symptom', 'Symptom'), one('warranty', 'Warranty', ['None', 'Manufacturer', 'Extended', 'Home warranty']), t('claim', 'Warranty claim #'), materials('Parts used')],
    checklist: ['Confirm the symptom', 'Record model and serial', 'Diagnose', 'Order part if needed', 'Repair', 'Run a full cycle to test'] },
  garage: { family: 'service', name: 'Garage doors', icon: '🚪', job: 'Garage door job', fields: [
    one('kind', 'Kind of job', ['Repair', 'New door', 'New opener', 'Springs', 'Tune-up']), t('size', 'Door size'), one('spring', 'Springs', ['Torsion', 'Extension']),
    equipment('Opener'), t('problem', 'What’s wrong'), materials('Parts used')],
    checklist: ['Inspect springs, cables and rollers', 'Repair or replace parts', 'Lubricate', 'Balance the door', 'Test the safety reverse', 'Program remotes'] },
  locksmith: { family: 'service', name: 'Locksmith', icon: '🔑', job: 'Locksmith job', fields: [
    one('kind', 'Kind of job', ['Lockout', 'Rekey', 'New locks', 'Smart lock', 'Safe', 'Car key']), n('locks', 'Locks'), n('keys', 'Keys made'), t('hardware', 'Hardware / brand')],
    checklist: ['Verify ID and ownership', 'Do the work', 'Test every key', 'Hand over keys'] },
  generator: { family: 'service', name: 'Generators', icon: '🔋', job: 'Generator job', fields: [
    one('kind', 'Kind of job', ['Install', 'Maintenance', 'Repair']), equipment('Generator'), t('fuel', 'Fuel'), n('hours', 'Run hours'),
    readings(['Voltage V', 'Frequency Hz', 'Oil level']), materials('Parts used')],
    checklist: ['Change oil and filter', 'Check battery', 'Load test', 'Check transfer switch', 'Set the next service date'] },
  water: { family: 'service', name: 'Water heaters, wells and septic', icon: '💧', job: 'Water system job', fields: [
    one('system', 'System', ['Water heater', 'Tankless', 'Well pump', 'Water softener', 'Septic', 'Filtration']), equipment(), t('problem', 'What’s wrong'),
    readings(['Pressure psi', 'Flow gpm', 'Hardness gpg']), materials('Parts used')],
    checklist: ['Inspect', 'Service or repair', 'Test', 'Record readings', 'Set the next service date'] },
  solar: { family: 'service', name: 'Solar', icon: '☀️', job: 'Solar job', fields: [
    one('kind', 'Kind of job', ['Install', 'Repair', 'Cleaning', 'Battery']), n('panels', 'Panels'), n('kw', 'System size (kW)'), equipment('Inverter / battery'),
    permit(), one('utility', 'Utility approval', ['Not started', 'Applied', 'Approved'])],
    checklist: ['Site survey', 'Permit', 'Mount and wire', 'Inspection', 'Utility approval', 'Turn on and test', 'Show the customer the app'] },

  // ----- installers -----
  blinds: { family: 'install', name: 'Blinds, shades and shutters', icon: '🪟', job: 'Window treatment job', fields: [
    many('product', 'Product', ['Blinds', 'Roller shades', 'Cellular shades', 'Roman shades', 'Shutters', 'Drapery', 'Motorized']), windows('Windows (W × H)', 'in'),
    one('mount', 'Mount', ['Inside', 'Outside', 'Mixed']), t('color', 'Color / fabric'), one('control', 'Control', ['Cordless', 'Wand', 'Cord', 'Motorized']), materials()],
    checklist: ['Measure every window', 'Confirm color and fabric', 'Place the order', 'Install', 'Test every shade', 'Show the customer how they work', 'Clean up'] },
  flooring: { family: 'install', name: 'Flooring', icon: '🪵', job: 'Flooring job', fields: [
    one('material', 'Material', ['Hardwood', 'Engineered', 'Laminate', 'Vinyl plank', 'Tile', 'Carpet']), areas('Rooms (L × W)'), t('product', 'Product / color'),
    one('subfloor', 'Subfloor', ['Plywood', 'Concrete', 'Needs repair']), yes('removal', 'Remove old floor'), yes('furniture', 'Move furniture'), materials()],
    checklist: ['Measure rooms', 'Acclimate material', 'Remove old flooring', 'Prep the subfloor', 'Install', 'Transitions and trim', 'Clean up and haul away'] },
  cabinets: { family: 'install', name: 'Cabinets and countertops', icon: '🍳', job: 'Cabinet / countertop job', fields: [
    one('material', 'Countertop', ['Quartz', 'Granite', 'Marble', 'Laminate', 'Butcher block', 'None']), t('edge', 'Edge'), areas('Counters (L × W)', 'in'),
    many('cutouts', 'Cutouts', ['Undermount sink', 'Drop-in sink', 'Cooktop', 'Faucet holes']), d('template', 'Template date'), materials()],
    checklist: ['Template', 'Customer approves the layout', 'Fabricate', 'Remove old tops', 'Install', 'Seal', 'Hook up sink and faucet'] },
  windows: { family: 'install', name: 'Windows and doors', icon: '🚪', job: 'Window / door job', fields: [
    windows('Openings (W × H)', 'in'), one('style', 'Style', ['Double hung', 'Casement', 'Slider', 'Picture', 'Entry door', 'Patio door']), one('frame', 'Frame', ['Vinyl', 'Wood', 'Fiberglass', 'Aluminum']),
    t('glass', 'Glass'), permit(), materials()],
    checklist: ['Measure openings', 'Order', 'Remove old units', 'Install and level', 'Insulate and flash', 'Trim and caulk', 'Clean up'] },
  roofing: { family: 'install', name: 'Roofing, siding and gutters', icon: '🏠', job: 'Roofing job', fields: [
    one('kind', 'Kind of job', ['Replacement', 'Repair', 'Siding', 'Gutters', 'Inspection']), n('squares', 'Squares'), t('pitch', 'Pitch'), n('layers', 'Layers to tear off'),
    t('material', 'Material / color'), t('claim', 'Insurance claim #'), permit(), materials()],
    checklist: ['Inspect and measure', 'Permit', 'Tear off', 'Dry-in', 'Install', 'Flashing and vents', 'Clean up and magnet sweep', 'Final photos'] },
  fencing: { family: 'install', name: 'Fences and decks', icon: '🪜', job: 'Fence / deck job', fields: [
    one('kind', 'Kind of job', ['Fence', 'Deck', 'Railing', 'Gate', 'Repair']), lengths('Runs (length)'), n('height', 'Height (ft)'), t('material', 'Material'), n('gates', 'Gates'),
    yes('locate', 'Utility locate called'), permit(), materials()],
    checklist: ['Call utility locate', 'Mark the line', 'Set posts', 'Panels / boards', 'Gates', 'Clean up'] },
  security: { family: 'install', name: 'Security, smart home and AV', icon: '📹', job: 'Install job', fields: [
    many('devices', 'Devices', ['Cameras', 'Doorbell', 'Alarm', 'Smart locks', 'Thermostat', 'Speakers', 'TV mount', 'Wi-Fi']), n('count', 'How many devices'),
    t('rooms', 'Rooms'), t('accounts', 'Accounts to set up'), materials()],
    checklist: ['Plan placement with the customer', 'Mount and wire', 'Connect to Wi-Fi', 'Set up the apps', 'Test everything', 'Walk the customer through it'] },
  ev: { family: 'install', name: 'EV chargers', icon: '🔌', job: 'EV charger install', fields: [
    t('charger', 'Charger model'), t('panel', 'Panel (brand, amps)'), n('run', 'Wire run (ft)'), one('circuit', 'Circuit', ['40 A', '50 A', '60 A']), permit(), materials()],
    checklist: ['Load calculation', 'Permit', 'Run the circuit', 'Mount the charger', 'Test charge', 'Inspection'] },
  closets: { family: 'install', name: 'Closets and garage storage', icon: '🗄️', job: 'Storage install', fields: [
    windows('Walls (W × H)', 'in'), t('layout', 'Layout'), t('finish', 'Finish'), materials()],
    checklist: ['Measure', 'Design approved', 'Order', 'Install', 'Adjust shelves and doors', 'Walk through'] },

  // ----- remodel and building -----
  painting: { family: 'project', name: 'Painting', icon: '🎨', job: 'Painting job', fields: [
    one('where', 'Interior or exterior', ['Interior', 'Exterior', 'Both']), areas('Rooms / areas'), t('colors', 'Colors (brand and code)'), one('sheen', 'Sheen', ['Flat', 'Eggshell', 'Satin', 'Semi-gloss', 'Gloss']),
    many('prep', 'Prep', ['Patch', 'Sand', 'Prime', 'Caulk', 'Power wash']), n('coats', 'Coats'), materials()],
    checklist: ['Move and cover furniture', 'Prep surfaces', 'Prime', 'First coat', 'Second coat', 'Touch-ups', 'Clean up', 'Walk through with the customer'] },
  drywall: { family: 'project', name: 'Drywall, tile and carpentry', icon: '🧱', job: 'Finish carpentry job', fields: [
    one('kind', 'Kind of job', ['Drywall', 'Tile', 'Trim', 'Framing', 'Repair']), areas('Areas'), t('finish', 'Finish / pattern'), materials()],
    checklist: ['Protect the area', 'Demo', 'Install', 'Finish', 'Clean up'] },
  concrete: { family: 'project', name: 'Concrete and masonry', icon: '🏗️', job: 'Concrete job', fields: [
    one('kind', 'Kind of job', ['Driveway', 'Patio', 'Sidewalk', 'Foundation', 'Block wall', 'Pavers', 'Repair']), areas('Areas'), n('thickness', 'Thickness (in)'),
    t('finish', 'Finish'), d('pour', 'Pour date'), permit(), materials()],
    checklist: ['Excavate', 'Forms and base', 'Rebar / mesh', 'Pour', 'Finish', 'Cure', 'Remove forms'] },
  remodel: { family: 'project', name: 'General contracting and remodels', icon: '🔨', job: 'Remodel', fields: [
    many('rooms', 'Rooms', ['Kitchen', 'Bathroom', 'Basement', 'Addition', 'Whole home']), t('scope', 'Scope'), t('subs', 'Subcontractors'), n('allowance', 'Allowances ($)'),
    permit(), materials()],
    checklist: ['Contract signed', 'Permit', 'Demo', 'Rough-in', 'Rough inspection', 'Close up', 'Finishes', 'Final inspection', 'Punch list', 'Final walk-through'] },
  insulation: { family: 'project', name: 'Insulation and waterproofing', icon: '🧤', job: 'Insulation job', fields: [
    one('kind', 'Kind of job', ['Attic', 'Walls', 'Crawlspace', 'Basement waterproofing', 'Foundation repair']), areas('Areas'), t('rvalue', 'R-value / method'),
    readings(['Moisture before %', 'Moisture after %']), materials()],
    checklist: ['Readings before', 'Prep', 'Install', 'Readings after', 'Clean up'] },
  handyman: { family: 'project', name: 'Handyman', icon: '🧰', job: 'Handyman job', fields: [
    t('tasks', 'Tasks'), n('hours', 'Hours'), materials()],
    checklist: ['Go over the list with the customer', 'Do each task', 'Clean up', 'Customer checks the work'] },

  // ----- recurring outdoor and home -----
  lawn: { family: 'recurring', name: 'Lawn care and landscaping', icon: '🌱', job: 'Lawn visit', fields: [
    often(), many('services', 'Services', ['Mow', 'Edge', 'Trim', 'Blow', 'Fertilize', 'Weed control', 'Aerate', 'Mulch', 'Leaf cleanup']), n('lot', 'Lot size (sq ft)'), materials('Products used')],
    checklist: ['Mow', 'Edge', 'Trim', 'Blow off hard surfaces', 'Close the gate'] },
  trees: { family: 'recurring', name: 'Tree service', icon: '🌳', job: 'Tree job', fields: [
    one('kind', 'Kind of job', ['Removal', 'Trim', 'Stump grinding', 'Storm cleanup']), n('trees', 'Trees'), t('species', 'Species'), n('height', 'Height (ft)'),
    yes('lines', 'Near power lines'), yes('stump', 'Grind the stump')],
    checklist: ['Set up the work zone', 'Rig and cut', 'Chip and haul', 'Grind stumps', 'Rake and clean up'] },
  pest: { family: 'recurring', name: 'Pest control', icon: '🐜', job: 'Pest service', fields: [
    often(), many('pests', 'Pests', ['Ants', 'Roaches', 'Spiders', 'Rodents', 'Termites', 'Bed bugs', 'Mosquitoes', 'Scorpions']), many('areas', 'Areas treated', ['Interior', 'Exterior', 'Yard', 'Attic', 'Crawlspace', 'Garage']),
    materials('Products applied (EPA # and amount)'), t('notes', 'Activity seen')],
    checklist: ['Inspect', 'Treat', 'Log products and amounts', 'Leave the service notice', 'Set the next visit'] },
  pool: { family: 'recurring', name: 'Pools and spas', icon: '🏊', job: 'Pool service', fields: [
    often(), n('gallons', 'Gallons'), equipment('Pump / filter / heater'),
    readings(['Chlorine ppm', 'pH', 'Alkalinity ppm', 'Calcium hardness ppm', 'Cyanuric acid ppm', 'Salt ppm']), materials('Chemicals added')],
    checklist: ['Test the water', 'Add chemicals', 'Skim and brush', 'Vacuum', 'Empty baskets', 'Check equipment', 'Backwash if needed'] },
  irrigation: { family: 'recurring', name: 'Irrigation and sprinklers', icon: '💦', job: 'Irrigation job', fields: [
    one('kind', 'Kind of job', ['Repair', 'Start-up', 'Winterize', 'Install', 'Inspection']), n('zones', 'Zones'), t('controller', 'Controller'), materials('Parts used')],
    checklist: ['Run every zone', 'Fix heads and leaks', 'Adjust coverage', 'Set the schedule'] },
  snow: { family: 'recurring', name: 'Snow removal', icon: '❄️', job: 'Snow visit', fields: [
    many('areas', 'Areas', ['Driveway', 'Walkways', 'Parking lot', 'Steps', 'Roof']), yes('salt', 'Salt / ice melt'), n('trigger', 'Trigger depth (in)')],
    checklist: ['Plow', 'Shovel walks and steps', 'Salt', 'Photo when done'] },
  exterior: { family: 'recurring', name: 'Window, pressure and gutter cleaning', icon: '🧽', job: 'Exterior cleaning', fields: [
    often(), many('services', 'Services', ['Windows', 'Pressure washing', 'Gutters', 'Roof wash', 'Solar panels', 'Holiday lights']), n('stories', 'Stories'), t('surfaces', 'Surfaces')],
    checklist: ['Before photos', 'Clean', 'After photos', 'Customer checks'] },

  // ----- cleaning, restoration and hauling -----
  cleaning: { family: 'cleaning', name: 'House cleaning and janitorial', icon: '🧹', job: 'Cleaning', fields: [
    often(), one('kind', 'Kind of clean', ['Standard', 'Deep clean', 'Move-in / out', 'Office', 'Post-construction']), n('bedrooms', 'Bedrooms'), n('bathrooms', 'Bathrooms'), n('sqft', 'Square feet'),
    many('extras', 'Extras', ['Inside oven', 'Inside fridge', 'Windows', 'Laundry', 'Baseboards'])],
    checklist: ['Kitchen', 'Bathrooms', 'Bedrooms', 'Living areas', 'Floors', 'Trash out', 'Lock up'] },
  carpet: { family: 'cleaning', name: 'Carpet and upholstery', icon: '🛋️', job: 'Carpet cleaning', fields: [
    areas('Rooms'), many('extras', 'Extras', ['Stairs', 'Upholstery', 'Rugs', 'Pet treatment', 'Protector']), t('stains', 'Stains')],
    checklist: ['Pre-treat', 'Clean', 'Groom', 'Tell the customer the dry time'] },
  restoration: { family: 'cleaning', name: 'Water, fire and mold restoration', icon: '🌊', job: 'Restoration job', fields: [
    one('damage', 'Damage', ['Water', 'Fire / smoke', 'Mold', 'Storm', 'Sewage']), one('category', 'Water category', ['1 · Clean', '2 · Gray', '3 · Black']), areas('Affected areas'),
    t('claim', 'Insurance claim #'), t('adjuster', 'Adjuster'), equipment('Equipment on site'), readings(['Moisture %', 'Relative humidity %', 'Temperature °F'], 'Daily readings')],
    checklist: ['Stop the source', 'Photos of everything', 'Extract water', 'Set drying equipment', 'Daily moisture readings', 'Remove equipment when dry', 'Send the report to the adjuster'] },
  junk: { family: 'cleaning', name: 'Junk removal and moving', icon: '🚚', job: 'Haul / move', fields: [
    one('kind', 'Kind of job', ['Junk removal', 'Local move', 'Long-distance move', 'Packing']), t('items', 'Items'), one('volume', 'Volume', ['Small load', '1/4 truck', '1/2 truck', 'Full truck']),
    n('stairs', 'Flights of stairs'), n('crew', 'Crew size')],
    checklist: ['Walk through with the customer', 'Protect floors and doorways', 'Load', 'Haul', 'Dump / delivery receipt', 'Sweep up'] },

  // ----- mobile and specialty -----
  auto: { family: 'mobile', name: 'Mobile auto detailing and repair', icon: '🚗', job: 'Vehicle service', fields: [
    t('vehicle', 'Vehicle (year, make, model)'), t('plate', 'Plate / VIN'), one('package', 'Package', ['Wash', 'Interior', 'Full detail', 'Ceramic', 'Repair']), t('condition', 'Condition notes')],
    checklist: ['Walk-around photos', 'Do the service', 'Final photos', 'Customer checks the car'] },
  // A trade can have its own stages (towing moves differently from a pet groom) and call its address something else.
  towing: { family: 'mobile', name: 'Towing and roadside', icon: '🛻', job: 'Tow', address: 'Pickup location',
    stages: ['Call in', 'Dispatched', 'En route', 'On scene', 'Towing', 'Dropped off', 'Stored', 'Invoiced', 'Paid'], fields: [
    one('kind', 'Call type', ['Tow', 'Jump start', 'Lockout', 'Tire change', 'Fuel delivery', 'Winch-out', 'Accident', 'Impound', 'Private property']),
    one('source', 'Who called', ['Customer', 'Motor club', 'Police', 'Body shop', 'Dealer', 'Property manager']), t('reference', 'Motor club / police / PO #'),
    t('vehicle', 'Vehicle (year, make, model, color)'), t('plate', 'Plate'), t('vin', 'VIN'), t('dropoff', 'Drop-off location'),
    n('miles', 'Miles towed'), one('truck', 'Truck', ['Flatbed', 'Wheel-lift', 'Heavy duty', 'Service truck']), yes('keys', 'Keys with the vehicle'),
    d('stored', 'In storage since'), t('damage', 'Existing damage')],
    checklist: ['Confirm the location and vehicle', 'Walk-around photos before hookup', 'Note existing damage', 'Release signed (customer or officer)', 'Secure the vehicle', 'Photos at drop-off', 'Payment or PO number taken'] },
  courier: { family: 'mobile', name: 'Courier and delivery', icon: '📦', job: 'Delivery', address: 'Pickup address',
    stages: ['Booked', 'Picked up', 'In transit', 'Delivered', 'Invoiced', 'Paid'], fields: [
    t('dropoff', 'Delivery address'), t('recipient', 'Recipient'), n('pieces', 'Pieces'), n('weight', 'Weight (lb)'),
    one('speed', 'Service', ['Same day', 'Rush', 'Scheduled', 'Route']), t('instructions', 'Delivery instructions')],
    checklist: ['Confirm pickup', 'Photo at pickup', 'Photo at delivery', 'Recipient signs'] },
  pets: { family: 'mobile', name: 'Mobile pet grooming', icon: '🐶', job: 'Grooming', fields: [
    t('pet', 'Pet name'), t('breed', 'Breed'), one('service', 'Service', ['Bath', 'Full groom', 'Nails', 'De-shed']), t('notes', 'Behavior / health notes')],
    checklist: ['Check in the pet', 'Groom', 'Photo', 'Hand back to the owner'] },
  inspection: { family: 'mobile', name: 'Home inspections and audits', icon: '🔍', job: 'Inspection', fields: [
    one('kind', 'Kind of inspection', ['Home inspection', 'Energy audit', 'Radon', 'Mold', 'Chimney', 'Pre-listing']), n('sqft', 'Square feet'), n('year', 'Year built'),
    readings(['Radon pCi/L', 'Blower door CFM50']), t('findings', 'Main findings')],
    checklist: ['Exterior', 'Roof', 'Attic', 'Plumbing', 'Electrical', 'HVAC', 'Interior', 'Write the report'] },
};

// Steps for the kinds of job that go differently from the trade's own list (column-fe's crew test, 2026-11-28: a
// gutter job got the roofing tear-off). By trade, then by the label of its "Kind of job" choice; a kind left out
// starts with the trade's checklist.
const ESTIMATE = ['Look over the job with the customer', 'Measure', 'Photos', 'Work out the options and prices', 'Send the quote'];
export const KIND_STEPS = {
  hvac: {
    Maintenance: ['Check the thermostat', 'Replace the filter', 'Clean the coils', 'Check refrigerant and pressures', 'Check electrical connections and capacitor', 'Clear the drain line', 'Test heating and cooling', 'Record readings', 'Set the next service date'],
    Install: ['Confirm sizing (load calculation)', 'Permit', 'Remove the old equipment', 'Set the new equipment', 'Line set, wiring and drain', 'Vacuum and charge', 'Start up and test', 'Record readings and serial numbers', 'Register the warranty', 'Walk the customer through the thermostat'],
    Estimate: ESTIMATE,
  },
  plumbing: {
    Clog: ['Find which drain', 'Protect floors', 'Snake or jet the line', 'Camera the line if it keeps coming back', 'Run water to test', 'Clean up'],
    'Water heater': ['Shut off water and gas or power', 'Drain the old tank', 'Remove the old heater', 'Set the new heater', 'Connect water and gas or power', 'Check for leaks', 'Test the relief valve', 'Fill and turn on', 'Haul away the old one', 'Register the warranty'],
    Estimate: ESTIMATE,
  },
  electrical: {
    'Panel upgrade': ['Permit', 'Book the utility disconnect', 'Turn off and lock out', 'Swap the panel', 'Move and label the circuits', 'Ground and bond', 'Inspection', 'Utility reconnect', 'Test every circuit', 'Photos of the panel'],
    'EV charger': ['Load calculation', 'Permit', 'Run the circuit', 'Mount the charger', 'Test charge', 'Inspection'],
    Inspection: ['Check the panel', 'Test outlets and GFCIs', 'Check smoke and CO detectors', 'Note what needs fixing', 'Write the report'],
  },
  garage: {
    'Tune-up': ['Inspect springs, cables and rollers', 'Lubricate', 'Tighten the hardware', 'Balance the door', 'Test the safety reverse', 'Check the opener'],
    'New door': ['Measure the opening', 'Order the door', 'Remove the old door', 'Install tracks and springs', 'Hang the door', 'Connect the opener', 'Test the safety reverse', 'Haul away the old door'],
    'New opener': ['Remove the old opener', 'Mount the opener', 'Wire it and set the sensors', 'Program remotes and keypad', 'Test the safety reverse', 'Show the customer the app'],
    Springs: ['Measure the old springs', 'Unwind safely', 'Replace springs and cables', 'Balance the door', 'Test the safety reverse'],
  },
  generator: {
    Install: ['Site survey', 'Permit', 'Set the pad', 'Set the generator', 'Gas line', 'Transfer switch', 'Inspection', 'Start up and test', 'Show the customer how it works'],
  },
  solar: {
    Cleaning: ['Check the roof is safe to work', 'Output before', 'Rinse the panels', 'Clean with a soft brush', 'Check for damage', 'Output after'],
  },
  roofing: {
    Repair: ['Find the leak', 'Photos before', 'Repair', 'Seal and flash', 'Photos after', 'Clean up'],
    Siding: ['Measure the walls', 'Order', 'Remove the old siding', 'House wrap', 'Install the siding', 'Trim and corners', 'Caulk', 'Clean up and magnet sweep', 'Final photos'],
    Gutters: ['Measure runs and downspouts', 'Confirm color and size', 'Remove the old gutters', 'Hang the gutters with the right pitch', 'Downspouts and elbows', 'Seal the seams', 'Run water to test', 'Clean up', 'Final photos'],
    Inspection: ['Walk the roof', 'Photos of every slope', 'Check flashing, vents and gutters', 'Note the damage', 'Write the report'],
  },
  fencing: {
    Deck: ['Call utility locate', 'Permit', 'Footings', 'Framing', 'Decking', 'Railings and stairs', 'Inspection', 'Clean up'],
    Repair: ['Photos before', 'Replace the broken parts', 'Photos after', 'Clean up'],
  },
  concrete: {
    Pavers: ['Call utility locate', 'Mark the layout', 'Excavate', 'Base gravel and compact', 'Sand bed', 'Lay the pavers', 'Cut the edges', 'Edge restraint', 'Polymeric sand', 'Compact and clean up'],
    Repair: ['Photos before', 'Cut out or grind', 'Patch or replace', 'Finish', 'Photos after'],
  },
  trees: {
    'Stump grinding': ['Call utility locate', 'Grind the stumps', 'Fill the holes', 'Rake and clean up'],
    'Storm cleanup': ['Make the area safe', 'Photos for insurance', 'Cut and clear', 'Chip and haul', 'Rake and clean up'],
  },
  irrigation: {
    'Start-up': ['Turn on the water', 'Run every zone', 'Fix heads and leaks', 'Adjust coverage', 'Set the schedule'],
    Winterize: ['Shut off the water', 'Blow out every zone', 'Drain the backflow', 'Turn the controller off', 'Tag the system'],
  },
  junk: {
    'Junk removal': ['Walk through with the customer', 'Confirm the price', 'Load', 'Sweep up', 'Dump receipt'],
    Packing: ['Boxes and supplies', 'Pack room by room', 'Label every box', 'Inventory list'],
  },
};

// A trade as a list for a Jobs project: the core fields, the trade's, then checklist, photos and sign-off.
export function tradeType(key) {
  const tr = TRADES[key];
  if (!tr) return null;
  const fam = FAMILIES[tr.family];
  const spec = ([fkey, name, type, extra]) => ({ key: fkey, name, type, ...(extra || {}) });
  return {
    key: 'trade_' + key, name: tr.name.length > 24 ? tr.job + 's' : tr.name, singular: tr.job, icon: tr.icon, primary: 'job', trade: key,
    fields: [
      { key: 'job', name: 'Job', type: 'text' },
      { key: 'customer', name: 'Customer', type: 'contact' },
      { key: 'status', name: 'Status', type: 'select', choices: choices(tr.stages || fam.stages) },
      { key: 'address', name: tr.address || 'Address', type: 'text' },
      { key: 'scheduled', name: 'Scheduled', type: 'date' },
      { key: 'crew', name: 'Assigned to', type: 'person' },
      { key: 'value', name: 'Value', type: 'money' },
      { key: 'access', name: 'Access notes', type: 'text', hint: 'Pets, parking, which door' },
      // Codes are sealed (shown on Show, each look on the timeline), never in a notes field anyone can read.
      { key: 'entry', name: 'Gate / lockbox code', type: 'secret' },
      ...(EXTRA[tr.family] || []).filter((f) => !tr.fields.some((x) => x[0] === f.key)),
      ...(FOR_TRADE[key] || []),
      { key: 'price', name: 'Price', type: 'items' },
      ...tr.fields.map(spec),
      { key: 'checklist', name: 'Checklist', type: 'checklist', list: tr.checklist, ...(KIND_STEPS[key] ? { kinds: { field: 'kind', lists: KIND_STEPS[key] } } : {}) },
      { key: 'before', name: 'Before photos', type: 'files' },
      { key: 'after', name: 'After photos', type: 'files' },
      { key: 'signoff', name: 'Customer sign-off', type: 'signature' },
    ],
    views: [{ name: 'Board', kind: 'board', groupBy: 'status' }, { name: 'Calendar', kind: 'calendar', start: 'scheduled' }, { name: 'By date', kind: 'table', sortBy: 'scheduled' }],
  };
}

// What a family's jobs also ask (docs/research/reports/Kloomie trade workflows research.md): installers and
// builders need the HOA's approval before outside work, and builders need the year the home was built (homes
// before 1978 come under the EPA's lead-safe rules).
const HOA = { key: 'hoa', name: 'HOA approval', type: 'select', choices: choices(['No HOA', 'Needs approval', 'Submitted', 'Approved', 'Denied']) };
const EXTRA = {
  install: [HOA],
  project: [{ key: 'year', name: 'Year built', type: 'number', hint: 'Before 1978: lead-safe work rules apply' }, HOA],
};
// And what one trade asks: in the Las Vegas valley the water district sets each address's watering days by group.
const FOR_TRADE = {
  lawn: [{ key: 'watering', name: 'Watering group', type: 'text', hint: 'The water district’s group for this address' }],
  irrigation: [{ key: 'watering', name: 'Watering group', type: 'text', hint: 'The water district’s group for this address' }],
};

// Lists a trades project gets beside its jobs. Service plans: the memberships and recurring agreements that repair
// and route businesses live on. Customer equipment: the customer's own units (not the company's gear), with their
// history, warranty and age. Licenses & insurance: what the business must keep current, with days left.
const often2 = (labels) => ({ type: 'select', choices: choices(labels) });
export const COMPANIONS = {
  plans: { key: 'plans', name: 'Service plans', singular: 'Plan', icon: '🔁', primary: 'plan', fields: [
    { key: 'plan', name: 'Plan', type: 'text' },
    { key: 'customer', name: 'Customer', type: 'contact' },
    { key: 'status', name: 'Status', ...often2(['Active', 'Paused', 'Cancelled', 'Ended']) },
    { key: 'often', name: 'How often', ...often2(['Weekly', 'Every 2 weeks', 'Monthly', 'Every 2 months', 'Quarterly', 'Twice a year', 'Yearly']) },
    { key: 'visits', name: 'Visits a year', type: 'number' },
    { key: 'price', name: 'Price', type: 'money' },
    { key: 'billing', name: 'Billing', ...often2(['Monthly autopay', 'Yearly up front', 'Each visit']) },
    { key: 'discount', name: 'Member discount %', type: 'number' },
    { key: 'started', name: 'Started', type: 'date' },
    { key: 'renews', name: 'Renews', type: 'date' },
    { key: 'next', name: 'Next visit due', type: 'date' },
    { key: 'notes', name: 'Notes', type: 'text', long: true },
  ], views: [{ name: 'Board', kind: 'board', groupBy: 'status' }, { name: 'Renewing', kind: 'table', sortBy: 'renews' }, { name: 'Calendar', kind: 'calendar', start: 'next' }] },
  equipment: { key: 'equipment', name: 'Customer equipment', singular: 'Unit', icon: '⚙️', primary: 'name', fields: [
    { key: 'name', name: 'Name', type: 'text', hint: 'e.g. Upstairs AC, Pool pump' },
    { key: 'customer', name: 'Customer', type: 'contact' },
    { key: 'unit', name: 'Make, model, serial', type: 'equipment' },
    { key: 'where', name: 'Where it is', type: 'text', hint: 'Attic, side yard, garage' },
    { key: 'installed', name: 'Installed', type: 'date' },
    { key: 'age', name: 'Age (years)', type: 'formula', expr: 'round((today() - {Installed}) / 365, 1)', format: 'number' },
    { key: 'warranty', name: 'Warranty ends', type: 'date' },
    { key: 'serviced', name: 'Last serviced', type: 'date' },
    { key: 'notes', name: 'Notes', type: 'text', long: true },
  ], views: [{ name: 'All', kind: 'table', sortBy: 'name' }] },
  licenses: { key: 'licenses', name: 'Licenses & insurance', singular: 'License', icon: '🪪', primary: 'name', fields: [
    { key: 'name', name: 'Name', type: 'text' },
    { key: 'kind', name: 'Kind', ...often2(['Contractor license (NSCB)', 'State business license', 'County or city business license', 'General liability insurance', 'Workers’ comp', 'Bond', 'Vehicle insurance', 'Certification (EPA, ISA, pest…)', 'Vehicle registration', 'Other']) },
    { key: 'number', name: 'Number', type: 'text' },
    { key: 'whose', name: 'Whose', type: 'person', hint: 'Empty for the business' },
    { key: 'limit', name: 'Limit', type: 'money', hint: 'A contractor license’s monetary limit' },
    { key: 'expires', name: 'Expires', type: 'date' },
    { key: 'left', name: 'Days left', type: 'formula', expr: '{Expires} - today()', format: 'days' },
    { key: 'files', name: 'Copies', type: 'files' },
    { key: 'notes', name: 'Notes', type: 'text', long: true },
  ], views: [{ name: 'By expiry', kind: 'table', sortBy: 'expires' }, { name: 'Calendar', kind: 'calendar', start: 'expires' }] },
};
// Which of them a trades project gets, from the trades picked: plans for repair, recurring and cleaning work;
// equipment for repair work and the trades that service a customer's units. Licenses & insurance live in the
// workspace profile (projects.js profileOf), once for the business, not on each board (the owner, 2026-11-19).
const UNIT_TRADES = new Set(['pool', 'irrigation', 'security', 'ev', 'garage']);
export function companionTypes(keys) {
  const fams = new Set(keys.map((k) => TRADES[k]?.family).filter(Boolean));
  return [
    ...(['service', 'recurring', 'cleaning'].some((f) => fams.has(f)) ? [COMPANIONS.plans] : []),
    ...(fams.has('service') || keys.some((k) => UNIT_TRADES.has(k)) ? [COMPANIONS.equipment] : []),
  ];
}

// The trades grouped by family, for the "what kind of work do you do?" picker.
export const tradeMenu = () => Object.entries(FAMILIES).map(([fk, f]) => ({ key: fk, name: f.name, about: f.about,
  trades: Object.entries(TRADES).filter(([, x]) => x.family === fk).map(([k, x]) => ({ key: k, name: x.name, icon: x.icon })) }));
