import {buildMockCartResponse} from './fixtures/publicApi';
import {resolvePizza} from '../src/domain/pizza.js';
import {test,expect} from '@playwright/test';
const pizza={version:1,revision:'r1',pricingMode:'highest',sizes:[{id:'g',name:'Grande',maxFlavors:2,active:true,stockProductId:null}],flavors:[{id:'a',name:'Calabresa',active:true,prices:{g:40}},{id:'b',name:'Portuguesa',active:true,prices:{g:60}}]};
test('monta meio a meio e preserva escolhas após recarregar',async({page})=>{
 await page.route('**/api/public/zelomenu/store/**',async route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();expect(body.items[0].pizzaSelection).toEqual({revision:'r1',sizeId:'g',flavorIds:['a','b']});await route.fulfill({status:400,json:{error:'Teste concluído'}});return;}
  await route.fulfill({json:{business:{name:'Pizzaria',address:'Rua 1',pixEnabled:false,deliveryEnabled:false,businessHours:{configured:false,openNow:true}},catalog:[{nome:'Pizzas',subcategorias:[],produtosDireto:[{id:10,name:'Tradicionais',productType:'pizza',pizza,basePrice:40,price:40,available:true,modifierGroups:[]}]}]}});
 });
 await page.goto('/pizza-teste');
 await page.getByRole('button',{name:'Adicionar Tradicionais',exact:true}).first().click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Tamanho',exact:true}).selectOption('g');
 await dialog.getByRole('combobox',{name:'Quantidade de sabores',exact:true}).selectOption('2');
 await dialog.getByRole('checkbox').nth(0).check();
 await expect(dialog.getByRole('button',{name:'Corrija a seleção',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox').nth(1).check();
 await expect(dialog.getByText('R$ 60,00',{exact:true}).first()).toBeVisible();
 await page.screenshot({path:'test-results/pizza-montagem-'+test.info().project.name+'.png',fullPage:true});
 await dialog.getByRole('button',{name:'Adicionar',exact:true}).click();
 await page.reload();
 const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('zelomenu_cart_pizza-teste')!));
 expect(Object.values(cached.items)[0]).toMatchObject({unitPrice:60,pizzaSelection:{flavorIds:['a','b']}});
 await page.getByRole('button',{name:/ver sacola/i}).click();
});

test('edita pizza no carrinho e envia nova composição no autosave',async({page})=>{
 const resolved=resolvePizza(pizza,{revision:'r1',sizeId:'g',flavorIds:['a','b']});if(!resolved.ok)throw new Error(resolved.message);
 let response:any=buildMockCartResponse({revision:1,quote:{deliveryStatus:'quoted',deliveryFee:0,deliveryFeeToConfirm:false},fulfillment:{type:'pickup',asap:true},patchDelayMs:0});
 response.session.metadata={slug:'pizza-teste'};
 response.session.cart.items=[{productId:10,productName:'Tradicionais',baseUnitPrice:60,selectedModifiers:resolved.modifiers,pizza:resolved.pizza,modifierDeltaTotal:0,quantity:1,unitPrice:60,lineTotal:60,notes:null}];
 response.session.pricing.subtotal=60;response.session.pricing.total=60;
 response.catalog=[{nome:'Pizzas',subcategorias:[],produtosDireto:[{id:10,name:'Tradicionais',productType:'pizza',pizza,basePrice:40,price:40,available:true,modifierGroups:[]}]}];
 let updated=false;
 await page.route('**/api/public/zelomenu/cart/**',async route=>{
  if(route.request().method()==='PATCH'){
   const body=route.request().postDataJSON();
   if(body.items?.[0]?.pizzaSelection?.flavorIds?.length===1){
    expect(body.items[0].pizzaSelection.flavorIds).toEqual(['a']);
    expect(body.items[0].selectedOptions).toEqual([]);updated=true;
    const r=resolvePizza(pizza,body.items[0].pizzaSelection);if(!r.ok)throw new Error(r.message);
    response.session.cart.items[0]={...response.session.cart.items[0],pizza:r.pizza,selectedModifiers:r.modifiers,baseUnitPrice:40,unitPrice:40,lineTotal:40};
    response.session.pricing.subtotal=40;response.session.pricing.total=40;
   }
   response.session.revision++;
  }
  await route.fulfill({json:response});
 });
 await page.goto('/menu/carrinho/pizza-token');
 await page.getByRole('button',{name:'Editar pizza',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('checkbox').nth(0)).toBeChecked();
 await expect(dialog.getByRole('checkbox').nth(1)).toBeChecked();
 await dialog.getByRole('combobox',{name:'Quantidade de sabores',exact:true}).selectOption('1');
 await dialog.getByRole('checkbox').nth(0).check();
 await dialog.getByRole('button',{name:'Atualizar',exact:true}).click();
 await expect.poll(()=>updated).toBe(true);
 await expect(page.getByText('Sabores: Calabresa',{exact:true})).toBeVisible();
});
