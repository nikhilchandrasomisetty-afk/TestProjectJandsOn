import { Recipes } from './items.js';

// Recipe matching is intentionally simple: a recipe is craftable when the player
// holds every listed ingredient. Smelting recipes additionally need a nearby
// furnace and one unit of fuel (coal).

export function canCraft(recipe, inventory, ctx) {
  if (recipe.bench && !ctx.nearWorkbench) return false;
  if (recipe.smelt) {
    if (!ctx.nearFurnace) return false;
    if (inventory.countOf(recipe.smelt.id) < recipe.smelt.count) return false;
    if (ctx.creative) return true;
    return inventory.countOf(1001) >= 1; // ItemIds.COAL
  }
  if (ctx.creative) return true;
  for (const ing of recipe.shapeless) {
    if (inventory.countOf(ing.id) < ing.count) return false;
  }
  return true;
}

export function craft(recipe, inventory, ctx) {
  if (!canCraft(recipe, inventory, ctx)) return false;
  if (!ctx.creative) {
    if (recipe.smelt) {
      inventory.remove(recipe.smelt.id, recipe.smelt.count);
      inventory.remove(1001, 1);
    } else {
      for (const ing of recipe.shapeless) inventory.remove(ing.id, ing.count);
    }
  }
  inventory.add(recipe.out.id, recipe.out.count);
  return true;
}

export function missingFor(recipe, inventory) {
  const missing = [];
  const list = recipe.smelt ? [recipe.smelt, { id: 1001, count: 1 }] : recipe.shapeless;
  for (const ing of list) {
    const have = inventory.countOf(ing.id);
    if (have < ing.count) missing.push({ id: ing.id, need: ing.count, have });
  }
  return missing;
}

export function allRecipes() { return Recipes; }
