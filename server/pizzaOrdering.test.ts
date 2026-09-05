import {describe,it,expect,vi} from 'vitest';
vi.mock('./zelomenuDeliveryService.js',()=>({revalidateDeliveryForCart:vi.fn(),createDeliveryQuoteRequest:vi.fn(),findDeliveryQuoteRequest:vi.fn()}));
import {resolveSnapshots,runRevalidation} from './zelomenuCartSessions';
import type {BusinessConfig} from './configStore';
const pizza={version:1 as const,revision:'r1',pricingMode:'highest' as const,sizes:[{id:'g',name:'Grande',maxFlavors:4,active:true,stockProductId:20}],flavors:[{id:'a',name:'Calabresa',active:true,prices:{g:40}},{id:'b',name:'Portuguesa',active:true,prices:{g:60}}]};
const config={name:'Loja',products:[{id:10,name:'Tradicionais',productType:'pizza',pizza,available:true,basePrice:40,price:40,modifierGroups:[]},{id:20,name:'Pizza pronta',available:false,stockControlled:true,stockQuantity:2,basePrice:0,price:0,modifierGroups:[]}],deliveryConfig:null,pixPayment:null,schedulingEnabled:false} as unknown as BusinessConfig;
const selection={revision:'r1',sizeId:'g',flavorIds:['a','b']};
const params=(quantity=1)=>({items:[{productId:10,productName:'Nome adulterado',quantity,pizzaSelection:selection}],fulfillment:{type:'pickup' as const},context:'public_order' as const});
describe('public pizza ordering',()=>{
 it('resolves canonical price/composition and hidden stock target',async()=>{
 const result=await resolveSnapshots('tenant',params(),config);
 expect(result.cart.items[0]).toMatchObject({productName:'Tradicionais',unitPrice:60,pizza:{sizeName:'Grande',stockProductId:20,flavors:[{name:'Calabresa',denominator:2},{name:'Portuguesa',denominator:2}]}});
 expect(result.cart.items[0].selectedModifiers.map(g=>g.groupId)).toEqual(['__pizza_size','__pizza_flavors']);
 });
 it('aggregates size stock across separate cart lines',async()=>{
 const p=params(2);p.items.push({...p.items[0],quantity:1});
 await expect(resolveSnapshots('tenant',p,config)).rejects.toThrow('STOCK_EXCEEDED');
 });
 it('revalidates latest revision and exposes changed price for acceptance',async()=>{
 const original=await resolveSnapshots('tenant',params(),config);
 const changed=structuredClone(config);changed.products[0].pizza!.revision='r2';changed.products[0].pizza!.flavors[1].prices.g=70;
 const result=await runRevalidation({metadata:{empresaId:'tenant'},cart:original.cart,pricing:original.pricing,payment:original.payment,fulfillment:original.fulfillment,context:'public_order'} as unknown as Parameters<typeof runRevalidation>[0],changed);
 expect(result.ok).toBe(false);expect(result.issues).toContainEqual(expect.objectContaining({code:'price_changed',previousUnitPrice:60,currentUnitPrice:70}));
 expect(result.previewCart?.items[0].pizza?.revision).toBe('r2');
 });
 it('rejects missing, duplicate, paused and stale selections' ,async()=>{
 for(const pizzaSelection of [undefined,{...selection,flavorIds:['a','a']},{...selection,flavorIds:['missing']},{...selection,revision:'old'}]){
 await expect(resolveSnapshots('tenant',{...params(),items:[{...params().items[0],pizzaSelection}]},config)).rejects.toThrow('MODIFIER_INVALID:');
 }
 });
});
