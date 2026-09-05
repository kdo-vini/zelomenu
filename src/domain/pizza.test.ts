import {describe,it,expect} from 'vitest';
import {buildCartItemKey} from './zelomenuCartItemKey';
import {resolvePizza} from './pizza.js';
const config={version:1,revision:'r',pricingMode:'average',sizes:[{id:'g',name:'Grande',maxFlavors:4}],flavors:[{id:'a',name:'A',prices:{g:40}},{id:'b',name:'B',prices:{g:60}},{id:'c',name:'C',prices:{g:60}}]};
describe('pizza contract',()=>{
 it('rounds thirds once and never sums parent price',()=>{expect(resolvePizza(config,{revision:'r',sizeId:'g',flavorIds:['a','b','c']})).toMatchObject({ok:true,baseUnitPrice:53.33});});
 it('keys equal sets independently of selection order and distinguishes notes',()=>{const a={revision:'r',sizeId:'g',flavorIds:['a','b']};const b={...a,flavorIds:['b','a']};expect(buildCartItemKey(1,[],'',a)).toBe(buildCartItemKey(1,[],'',b));expect(buildCartItemKey(1,[],'bem assada',a)).not.toBe(buildCartItemKey(1,[],'',a));});
});
