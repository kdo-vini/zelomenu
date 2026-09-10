/**
 * Palavras funcionais do português, para uso na busca do cardápio.
 *
 * A lista base é a do stemmer Snowball para português — a mesma que o
 * dicionário `portuguese` do Postgres usa no full-text search. É fechada,
 * linguística e mantida a montante: não cresce a cada frase nova de cliente.
 *
 * FIX 2026-09-09: a busca pontuava qualquer token compartilhado, e palavra
 * funcional aparece em nome de produto. `do` está em 7 dos 92 produtos
 * publicados da Bem Servido ("Marmita **do** dia") — longe de qualquer corte de
 * frequência — e casava "Gostaria **do** cardápio" com "Marmita do dia" com nota
 * máxima. `um` diluía "quero **um** penne" abaixo do piso e matava o acerto
 * certo. Estatística do catálogo não separa esses casos: num cardápio de 92
 * itens as palavras MAIS buscadas são as mais frequentes (`marmita` aparece em
 * 23 produtos), então um corte por frequência descartaria justamente o que o
 * cliente digita. A separação é linguística, não estatística.
 */
const SNOWBALL_PORTUGUESE = `
a as ao aos aquela aquelas aquele aqueles aquilo com como da das de dela delas
dele deles depois do dos e ela elas ele eles em entre era eram essa essas esse
esses esta estas este estes eu foi fomos for fora foram forem formos fosse
fossem fui ha isso isto ja lhe lhes mas me mesmo meu meus minha minhas muito
na nas nem no nos nossa nossas nosso nossos num numa o os ou para pela pelas
pelo pelos por qual quando que quem se seja sejam sem ser seu seus so sua suas
sao tambem te tem tinha tive tu tua tuas teu teus um uma umas uns vos voce
voces mais menos ate isso aqui ali entao assim ainda cada onde qualquer todo
toda todos todas outro outra outros outras muito muita muitos muitas pouco
pouca poucos poucas
`;

/**
 * Abreviações de WhatsApp brasileiro. Não estão no Snowball porque não são
 * português formal, mas são exatamente o que o cliente digita. Conjunto
 * pequeno e estável — se precisar crescer sem parar, o problema é outro.
 */
const WHATSAPP_SHORTHAND = `
vc vcs voce voces pf pfv pfvr blz obg obgd vlw flw kk kkk kkkk rs hj oq pq pra
pro pras pros ta tao to tou tbm tb msm mto mt aew ai eh ne neh vlw agr
`;

export const PORTUGUESE_SEARCH_STOPWORDS: ReadonlySet<string> = new Set(
  `${SNOWBALL_PORTUGUESE} ${WHATSAPP_SHORTHAND}`
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean),
);

export function isSearchStopword(token: string): boolean {
  return PORTUGUESE_SEARCH_STOPWORDS.has(token);
}
