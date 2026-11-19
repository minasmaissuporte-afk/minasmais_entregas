# Integração ERP → Minas Mais Entregas

Este documento é para a equipe técnica do ERP da Rede Minas Mais. Ele explica como configurar o envio automático das vendas para entrega.

Quando uma venda é finalizada no ERP e marcada como pedido para entrega, o ERP envia os dados da venda para esta API. O Sistema de Entregas cadastra a entrega na filial certa, mostra o pedido na central e oferece a entrega aos motoboys da cidade. Ninguém precisa digitar nada.

```
1. Venda finalizada no ERP (pedido para entrega)
2. ERP envia POST /entregas         → resposta 201 com o código da entrega (MM-000000)
3. Entrega aparece na central da filial e vai para os motoboys
4. ERP pode consultar, atualizar ou cancelar pela mesma venda (idVenda)
```

## 1. Endereços

| Item | Valor |
|---|---|
| URL base | `https://minas-mais-entregas.vercel.app/api/v1/erp` |
| Documentação interativa (Swagger) | `https://minas-mais-entregas.vercel.app/api/v1/erp/docs` |
| Especificação OpenAPI 3.1 (JSON) | `https://minas-mais-entregas.vercel.app/api/v1/erp/openapi.json` |
| Protocolo | Somente HTTPS. Corpo e respostas em JSON (UTF-8). |

## 2. Autenticação

- O administrador do Minas Mais gera um **token de integração** no painel, em **Painel técnico → Integração ERP → Credenciais**, e repassa à equipe do ERP por um canal seguro.
- O token tem o formato `mmerp_<12 caracteres>_<43 caracteres>`.
- Envie o token em todas as chamadas, no cabeçalho:

  ```
  Authorization: Bearer mmerp_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ```

  Também é aceito o cabeçalho `X-API-Key: <token>`.
- **Nunca** coloque o token na URL, em logs ou no código do frontend. Guarde-o como segredo no servidor do ERP.
- **Troca do token (rotação):**
  1. O administrador gera um token novo.
  2. O ERP passa a usar o token novo.
  3. O administrador revoga o token antigo.

  Um token revogado é recusado na hora (`401`).

## 3. Endpoints

| Método | Caminho | Para quê |
|---|---|---|
| `POST` | `/entregas` | Enviar uma venda para entrega |
| `GET` | `/entregas/{idVenda}` | Consultar a situação da entrega |
| `PATCH` | `/entregas/{idVenda}` | Atualizar dados (telefone, pagamento, observações, endereço…) |
| `POST` | `/entregas/{idVenda}/cancelar` | Cancelar a entrega |
| `GET` | `/health` | Verificar se a integração está no ar (não precisa de token) |

### 3.1 Enviar venda: `POST /entregas`

**Campos**

| Campo | Obrigatório | Tipo | Descrição |
|---|---|---|---|
| `idVenda` | **sim** | texto (até 64) | ID único da venda no ERP. Use letras, números, `.`, `-`, `/` ou `_`. |
| `codigoFilial` | **sim** | texto (até 32) | Código da filial no ERP. O administrador cadastra o mesmo código no Sistema de Entregas. |
| `dataVenda` | não | data-hora ISO 8601 | Ex.: `2026-11-19T10:30:00-03:00`. |
| `cliente.nome` | **sim** | texto (2 a 120) | Nome do cliente. |
| `cliente.telefone` | não | texto | Telefone com DDD. |
| `endereco.rua` | **sim** | texto (3 a 160) | Logradouro. |
| `endereco.numero` | não | texto | Vazio = "s/n". |
| `endereco.bairro` | não | texto | |
| `endereco.cidade` | não | texto | Vazio = cidade da filial. |
| `endereco.estado` | não | texto (2) | UF. |
| `endereco.cep` | não | texto | Com ou sem hífen. |
| `endereco.complemento` | não | texto | |
| `endereco.referencia` | não | texto | Ponto de referência. Aparece nas observações para o motoboy. |
| `pedido.numeroPedido` | não | texto | Número do pedido ou cupom mostrado ao motoboy. Padrão: o `idVenda`. |
| `pedido.valorTotal` | não | número | Valor dos produtos, **sem** a taxa de entrega. |
| `pedido.formaPagamento` | **sim, se não estiver pago** | texto | `DINHEIRO`, `PIX`, `CARTAO`, `CARTAO_CREDITO`, `CARTAO_DEBITO` ou `PAGO`. Não diferencia maiúsculas nem acentos. |
| `pedido.valorReceber` | não | número | Valor a receber na entrega. `0` significa que o pedido já está pago. |
| `pedido.trocoPara` | não | número | Troco para quanto (só para dinheiro). |
| `pedido.levarMaquininha` | não | booleano | Só para cartão. Padrão: `true`. |
| `pedido.pago` | não | booleano | `true` = o cliente já pagou produtos e entrega, e o motoboy não cobra. |
| `pedido.receita` | não | booleano | Medicamento com receita: o motoboy recolhe a receita. |
| `pedido.observacoes` | não | texto (até 500) | Observações da entrega. |

Valores em dinheiro podem ir como número (`58.9`) ou como texto (`"58,90"`). Campos desconhecidos são ignorados.

**Como o sistema calcula o valor cobrado na entrega:** valor dos produtos (`valorTotal`) + taxa de entrega da filial, que fica cadastrada no Sistema de Entregas. Se o ERP enviar um `valorReceber` diferente desse total, o valor do ERP aparece como aviso para a central e para o motoboy.

**Exemplo de requisição**

```http
POST /api/v1/erp/entregas
Authorization: Bearer mmerp_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "idVenda": "123456",
  "codigoFilial": "001",
  "dataVenda": "2026-11-19T10:30:00-03:00",
  "cliente": { "nome": "Maria da Silva", "telefone": "35999998888" },
  "endereco": {
    "cep": "37500-000",
    "rua": "Rua das Flores",
    "numero": "120",
    "bairro": "Centro",
    "cidade": "Itajubá",
    "estado": "MG",
    "complemento": "Apto 202",
    "referencia": "Em frente à praça"
  },
  "pedido": {
    "numeroPedido": "PED-98765",
    "valorTotal": 58.90,
    "formaPagamento": "DINHEIRO",
    "trocoPara": 100,
    "observacoes": "Interfone com defeito, ligar ao chegar."
  }
}
```

**Resposta `201 Created`** (entrega cadastrada)

```json
{
  "duplicada": false,
  "mensagem": "Entrega cadastrada e enviada para os motoboys.",
  "entrega": {
    "idVenda": "123456",
    "codigoEntrega": "MM-000231",
    "status": "OFFERED",
    "situacao": "Aguardando um motoboy aceitar",
    "filial": { "codigo": "001", "nome": "Drogaria Minas Mais Centro" },
    "cliente": { "nome": "Maria da Silva", "telefone": "35999998888" },
    "endereco": "Rua das Flores, 120, Apto 202 - Centro, Itajubá - MG, 37500-000",
    "numeroPedido": "PED-98765",
    "pagamento": {
      "formaPagamento": "DINHEIRO",
      "pago": false,
      "valorProdutos": 58.9,
      "taxaEntrega": 8,
      "valorCobrarNaEntrega": 66.9,
      "trocoPara": 100
    },
    "motoboy": null,
    "criadaEm": "2026-11-19T13:30:02.000Z",
    "atualizadaEm": "2026-11-19T13:30:02.000Z",
    "historico": [
      { "data": "2026-11-19T13:30:02.000Z", "descricao": "Entrega solicitada pelo ERP (venda 123456)" },
      { "data": "2026-11-19T13:30:02.000Z", "descricao": "Enviada para os motoboys de Itajubá" }
    ]
  },
  "requestId": "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60"
}
```

**Pedido já pago:** envie `"pedido": { "valorTotal": 32.5, "pago": true }`. Não precisa de `formaPagamento`, e o motoboy não cobra nada.

### 3.2 Consultar: `GET /entregas/{idVenda}`

Devolve `{ "entrega": { … }, "requestId": "…" }` no mesmo formato acima, com a situação atual e o histórico. Se a venda não existir, a resposta é `404 VENDA_NAO_ENCONTRADA`.

**Situações (`status`)**

| `status` | Significado |
|---|---|
| `REQUESTED`, `OFFERED`, `AWAITING_COURIER` | Aguardando um motoboy aceitar |
| `ACCEPTED`, `TO_STORE`, `AT_STORE` | Motoboy aceitou e está indo ou chegou à filial |
| `IN_TRANSIT` | Saiu para entrega |
| `COMPLETED` | Entregue |
| `CANCELLED` | Cancelada |
| `NOT_DELIVERED` | Não entregue (a central decide se reenvia) |

### 3.3 Atualizar: `PATCH /entregas/{idVenda}`

Envie só o que mudou. Os campos enviados substituem os anteriores.

```json
{ "cliente": { "telefone": "35988887777" }, "pedido": { "formaPagamento": "PIX", "observacoes": "Chamar no portão." } }
```

- `cliente` e `pedido` são atualizados campo a campo.
- `endereco`, se enviado, vem **completo**. Ele só pode mudar **antes de um motoboy aceitar** a entrega. Depois disso, a resposta é `409 ENDERECO_BLOQUEADO`.
- A filial não pode ser trocada (`409 FILIAL_NAO_ALTERAVEL`): cancele e envie a venda de novo.
- Uma entrega encerrada (entregue ou cancelada) não muda (`409 ENTREGA_ENCERRADA`).
- A resposta traz `"alterada": true` ou `false`, junto com a entrega atualizada.

### 3.4 Cancelar: `POST /entregas/{idVenda}/cancelar`

```json
{ "motivo": "Venda estornada no caixa" }
```

O motivo é opcional.

- A entrega é cancelada. Se já havia um motoboy, ele é liberado e recebe um aviso.
- Repetir o cancelamento não dá erro: a resposta traz `"jaEstavaCancelada": true`.
- Uma entrega já entregue não pode ser cancelada (`409 ENTREGA_ENCERRADA`).

### 3.5 Disponibilidade: `GET /health`

```json
{ "status": "ok", "versao": "v1", "dataHora": "2026-11-19T13:30:00.000Z" }
```

Não precisa de token. Se o token for enviado, a resposta inclui `"credencialValida": true` ou `false`, o que é útil para testar a configuração. Se a integração estiver fora do ar, a resposta é `503` com `"status": "indisponivel"`.

## 4. Idempotência (vendas duplicadas)

- A venda é identificada pelo `idVenda`. **Reenviar a mesma venda nunca cria uma segunda entrega.**
- No reenvio, a resposta é `200 OK` com `"duplicada": true`, os dados da entrega existente e o cabeçalho `Idempotent-Replayed: true`.
- A garantia vale também para envios simultâneos da mesma venda: há uma restrição única no banco de dados.
- **Recomendação:** se a conexão cair, se houver timeout ou se a resposta for `5xx`, reenvie a mesma requisição. Para mudar dados de uma venda já enviada, use o `PATCH`. Reenviar um `POST` com dados diferentes não altera a entrega.

## 5. Erros

Todos os erros seguem o mesmo formato:

```json
{
  "erro": {
    "codigo": "DADOS_INVALIDOS",
    "mensagem": "Confira os campos enviados.",
    "detalhes": [
      { "campo": "cliente.nome", "mensagem": "obrigatório" },
      { "campo": "endereco.rua", "mensagem": "obrigatório" }
    ]
  },
  "requestId": "5d1f2a64-3c3e-4f0f-9a51-1b2c3d4e5f60"
}
```

| HTTP | `codigo` | Quando | O que fazer |
|---|---|---|---|
| 400 | `DADOS_INVALIDOS` | Campo obrigatório faltando ou valor inválido (veja `detalhes`) | Corrigir o envio |
| 400 | `JSON_INVALIDO` | O corpo não é um JSON válido | Corrigir o envio |
| 401 | `CREDENCIAL_AUSENTE` / `CREDENCIAL_INVALIDA` | Token ausente, errado ou revogado | Conferir o token com o administrador |
| 403 | `HTTPS_OBRIGATORIO` | Chamada sem HTTPS | Usar `https://` |
| 404 | `VENDA_NAO_ENCONTRADA` | `idVenda` desconhecido em consulta, atualização ou cancelamento | Conferir o ID |
| 409 | `ENTREGA_ENCERRADA`, `ENDERECO_BLOQUEADO`, `FILIAL_NAO_ALTERAVEL`, `ENTREGA_EM_ROTA` | A situação atual da entrega não permite a operação | Falar com a central |
| 413 | `CORPO_MUITO_GRANDE` | O corpo passou de 64 KB | Reduzir o envio |
| 422 | `FILIAL_NAO_CADASTRADA` | O `codigoFilial` não está vinculado no Sistema de Entregas | Pedir ao administrador para cadastrar o código; depois reenviar ou ele reprocessa |
| 422 | `FILIAL_INATIVA` / `FILIAL_SEM_TARIFA` | Filial desativada ou sem taxa de entrega configurada | Falar com o administrador |
| 422 | `FORMA_PAGAMENTO_OBRIGATORIA` | Pedido não pago sem `formaPagamento` | Enviar a forma de pagamento ou `pago: true` |
| 429 | `LIMITE_REQUISICOES` / `MUITAS_TENTATIVAS` | Limite atingido | Esperar o tempo do cabeçalho `Retry-After` (em segundos) |
| 500 | `ERRO_INTERNO` | Falha inesperada | Reenviar (é idempotente) e informar o `requestId` |

Toda resposta tem o cabeçalho `X-Request-Id`. Informe esse valor ao suporte do Minas Mais quando precisar investigar um envio.

## 6. Limites

- 120 requisições por minuto por credencial.
- Depois de 20 tentativas com token inválido em 10 minutos, o IP fica bloqueado por 10 minutos.
- Corpo de até 64 KB por requisição.
- Tempo de resposta típico: menos de 2 segundos. Recomendamos um timeout de 15 segundos no ERP.

## 7. Homologação (passo a passo)

1. O administrador do Minas Mais:
   - gera um token em **Painel técnico → Integração ERP → Credenciais**, com um nome como "ERP homologação";
   - cadastra o **código do ERP** de cada filial em **Painel técnico → Integração ERP → Códigos das filiais**.
2. O ERP chama `GET /health` com o token e confirma que a resposta traz `"credencialValida": true`.
3. O ERP envia uma venda de teste para uma filial de teste (`POST /entregas`) e confere:
   - a resposta é `201` e traz o `codigoEntrega`;
   - a entrega aparece no painel da central em até 15 segundos.
4. O ERP reenvia a **mesma** venda e confere que a resposta é `200` com `duplicada: true`.
5. O ERP testa `GET`, `PATCH` e `POST …/cancelar` com essa venda.
6. O ERP envia uma venda com `codigoFilial` inexistente e confere o erro `422 FILIAL_NAO_CADASTRADA`. O erro também aparece no painel do administrador, em **Histórico**.
7. A central cancela as entregas de teste.
8. Para produção, o administrador gera o token de produção e revoga o de homologação.

## 8. O que o ERP precisa configurar

1. Disparar o envio quando a venda for **finalizada** e **marcada como entrega**: `POST /entregas` com os campos da seção 3.1.
2. Guardar o token como segredo no servidor e enviá-lo no cabeçalho `Authorization`.
3. Mapear a forma de pagamento do ERP para `DINHEIRO`, `PIX`, `CARTAO` ou `PAGO`.
4. Usar o **código da filial** do próprio ERP em `codigoFilial`. O administrador cadastra os mesmos códigos no Sistema de Entregas.
5. Reenviar automaticamente em caso de timeout ou erro `5xx`. É seguro, porque a API é idempotente.
6. Opcional:
   - enviar cancelamentos (`POST /entregas/{idVenda}/cancelar`) quando a venda for estornada;
   - enviar alterações de dados (`PATCH`);
   - consultar a situação (`GET`) para mostrar no ERP.
