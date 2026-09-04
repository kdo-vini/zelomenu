export const INTERNAL_ORDERING_ERROR_CODES = [
  'NAO_AUTORIZADO',
  'COMANDO_INVALIDO',
  'EMPRESA_INVALIDA',
  'CONVERSA_INVALIDA',
  'PEDIDO_INVALIDO',
  'ITEM_INVALIDO',
  'PEDIDO_VAZIO',
  'CLIENTE_INVALIDO',
  'PEDIDO_NAO_ENCONTRADO',
  'REVISAO_DESATUALIZADA',
  'RESUMO_EXPIRADO',
  'PEDIDO_EM_ANDAMENTO',
  'PEDIDO_FECHADO',
  'CONFIRMACAO_INVALIDA',
  'AI_TURN_REVOKED',
  'CONFIRMACAO_INDISPONIVEL',
  'PEDIDO_INDISPONIVEL',
  'MUITAS_REQUISICOES',
  'JSON_INVALIDO',
  'PAYLOAD_MUITO_GRANDE',
] as const;

export type InternalOrderingErrorCode = typeof INTERNAL_ORDERING_ERROR_CODES[number];

/** Compile-time guard for inline HTTP error emitters. */
export function internalOrderingErrorCode(code: InternalOrderingErrorCode): InternalOrderingErrorCode {
  return code;
}
