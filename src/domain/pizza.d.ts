import type { PizzaConfig, PizzaSelection, PizzaSnapshot } from './pizzaTypes';
import type { ZeloMenuSelectedModifierGroup } from './zelomenuModifiers';
export function resolvePizza(config: unknown, selection: unknown): {ok:true;pizza:PizzaSnapshot;baseUnitPrice:number;modifiers:ZeloMenuSelectedModifierGroup[]} | {ok:false;code:string;message:string};
export function validatePizzaConfig(config:unknown):{ok:true}|{ok:false;code:string;message:string};
export function pizzaStartingPrice(config:unknown):number|null;
export function buildPizzaSignature(selection:unknown):string;
export function pizzaModifiers(pizza:PizzaSnapshot|null):ZeloMenuSelectedModifierGroup[];
export function pizzaSelectionFromSnapshot(pizza:PizzaSnapshot|null):PizzaSelection|null;
export function pizzaStockRequirements(input:unknown):Array<{id_produto:number;quantidade:number}>;
