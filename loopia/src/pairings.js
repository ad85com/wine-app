/* ============================================================
   pairings.js — food pairing suggestions by grape & style
   Used by the wine detail view. Matches on grape names first
   (case-insensitive, partial), falls back to wine style.
   ============================================================ */

const GRAPE_PAIRINGS = {
  'cabernet sauvignon': ['Ribeye steak', 'Grilled lamb', 'Aged cheddar', 'Portobello mushrooms', 'Braised short ribs'],
  'merlot': ['Roast chicken', 'Pork tenderloin', 'Pasta bolognese', 'Soft cheeses', 'Duck breast'],
  'pinot noir': ['Duck', 'Salmon', 'Mushroom risotto', 'Roast turkey', 'Brie & camembert'],
  'syrah': ['BBQ ribs', 'Pepper-crusted steak', 'Venison', 'Smoked meats', 'Grilled aubergine'],
  'shiraz': ['BBQ ribs', 'Pepper-crusted steak', 'Venison', 'Smoked meats', 'Hard cheeses'],
  'grenache': ['Roast pork', 'Paella', 'Lamb tagine', 'Grilled vegetables', 'Charcuterie'],
  'garnacha': ['Roast pork', 'Paella', 'Lamb tagine', 'Grilled vegetables', 'Charcuterie'],
  'tempranillo': ['Jamón ibérico', 'Chorizo', 'Roast lamb', 'Manchego', 'Grilled octopus'],
  'sangiovese': ['Margherita pizza', 'Pasta al ragù', 'Bistecca fiorentina', 'Pecorino', 'Tomato-based dishes'],
  'nebbiolo': ['Truffle pasta', 'Braised beef', 'Risotto alla milanese', 'Aged parmesan', 'Wild game'],
  'barbera': ['Salumi', 'Pizza', 'Mushroom dishes', 'Roast pork', 'Tomato pasta'],
  'malbec': ['Grilled steak', 'Empanadas', 'Blue cheese', 'Lamb chops', 'Barbecue'],
  'zinfandel': ['Burgers', 'BBQ chicken', 'Spicy sausage', 'Chili con carne', 'Pulled pork'],
  'primitivo': ['Burgers', 'BBQ', 'Spicy sausage', 'Aged cheeses', 'Lamb kebabs'],
  'carmenere': ['Grilled meats', 'Roasted peppers', 'Spiced pork', 'Smoky dishes'],
  'cabernet franc': ['Roast chicken', 'Herbed lamb', 'Goat cheese', 'Ratatouille', 'Charcuterie'],
  'gamay': ['Charcuterie', 'Roast chicken', 'Salmon', 'Picnic food', 'Soft cheeses'],
  'mourvedre': ['Game', 'Braised lamb', 'Cassoulet', 'Grilled sausages'],
  'pinotage': ['Braai / BBQ', 'Smoked ribs', 'Venison', 'Spicy stews'],
  'touriga nacional': ['Roast lamb', 'Feijoada', 'Grilled chorizo', 'Hard cheeses'],
  'chardonnay': ['Lobster', 'Roast chicken', 'Creamy pasta', 'Crab cakes', 'Brie'],
  'sauvignon blanc': ['Goat cheese', 'Oysters', 'Asparagus', 'Ceviche', 'Green salads', 'Sushi'],
  'riesling': ['Thai curry', 'Spicy Asian dishes', 'Pork schnitzel', 'Apple desserts (sweet styles)', 'Smoked trout'],
  'pinot grigio': ['Light seafood', 'Antipasti', 'Caprese salad', 'Grilled white fish'],
  'pinot gris': ['Smoked salmon', 'Pork belly', 'Alsatian tarte flambée', 'Mild curries'],
  'gewurztraminer': ['Spicy Asian cuisine', 'Foie gras', 'Munster cheese', 'Aromatic curries'],
  'viognier': ['Roast chicken', 'Apricot-glazed pork', 'Scallops', 'Mild Indian dishes'],
  'chenin blanc': ['Pork', 'Sushi', 'Goat cheese', 'Apple salads', 'Fried chicken'],
  'albarino': ['Shellfish', 'Grilled sardines', 'Ceviche', 'Seafood paella'],
  'albariño': ['Shellfish', 'Grilled sardines', 'Ceviche', 'Seafood paella'],
  'gruner veltliner': ['Wiener schnitzel', 'Asparagus', 'Sushi', 'Fresh herbs & salads'],
  'grüner veltliner': ['Wiener schnitzel', 'Asparagus', 'Sushi', 'Fresh herbs & salads'],
  'verdejo': ['Seafood tapas', 'White fish', 'Fresh cheeses', 'Green vegetables'],
  'vermentino': ['Grilled fish', 'Pesto pasta', 'Seafood linguine', 'Citrus salads'],
  'semillon': ['Roast fish', 'Chicken pie', 'Blue cheese (sweet styles)', 'Honey-glazed dishes'],
  'sémillon': ['Roast fish', 'Chicken pie', 'Blue cheese (sweet styles)', 'Honey-glazed dishes'],
  'muscat': ['Fruit desserts', 'Blue cheese', 'Spiced cakes', 'Aperitif'],
  'moscato': ['Fruit desserts', 'Panna cotta', 'Brunch dishes', 'Light pastries'],
  'torrontes': ['Empanadas', 'Thai food', 'Ceviche', 'Aromatic dishes'],
  'nero d\'avola': ['Grilled tuna', 'Caponata', 'Sausage pasta', 'Lamb'],
  'montepulciano': ['Pizza', 'Lasagne', 'Grilled sausages', 'Pecorino'],
  'corvina': ['Risotto all\'amarone', 'Braised beef', 'Aged cheeses', 'Game'],
  'petit verdot': ['Char-grilled steak', 'Venison', 'Strong cheeses'],
  'petite sirah': ['Beef brisket', 'BBQ', 'Dark chocolate desserts'],
  'aglianico': ['Braised lamb shank', 'Aged cheeses', 'Rich pasta ragù'],
  'furmint': ['Foie gras', 'Blue cheese', 'Fruit tarts', 'Spicy dishes (dry styles)'],
  'palomino': ['Almonds & olives', 'Jamón', 'Fried fish', 'Tapas'],
};

const STYLE_PAIRINGS = {
  red: ['Red meats', 'Hard cheeses', 'Roasted vegetables', 'Rich pasta dishes'],
  white: ['Fish & seafood', 'Poultry', 'Salads', 'Soft cheeses'],
  rose: ['Provençal cuisine', 'Grilled seafood', 'Charcuterie', 'Summer salads', 'Niçoise salad'],
  sparkling: ['Oysters', 'Fried food', 'Sushi', 'Canapés', 'Celebration!'],
  sweet: ['Blue cheese', 'Foie gras', 'Fruit desserts', 'Crème brûlée'],
  fortified: ['Dark chocolate', 'Blue cheese', 'Nuts & dried fruit', 'Rich desserts'],
};

function getPairings(wine) {
  const found = [];
  const seen = new Set();
  const grapes = (wine.grapes || []).map(g => g.trim().toLowerCase()).filter(Boolean);

  for (const grape of grapes) {
    // exact match first, then partial (e.g. "old vine zinfandel")
    let list = GRAPE_PAIRINGS[grape];
    if (!list) {
      const key = Object.keys(GRAPE_PAIRINGS).find(k => grape.includes(k) || k.includes(grape));
      if (key) list = GRAPE_PAIRINGS[key];
    }
    if (list) for (const p of list) {
      if (!seen.has(p)) { seen.add(p); found.push(p); }
    }
  }

  if (found.length < 3) {
    for (const p of (STYLE_PAIRINGS[wine.style] || [])) {
      if (!seen.has(p)) { seen.add(p); found.push(p); }
    }
  }

  return found.slice(0, 8);
}
