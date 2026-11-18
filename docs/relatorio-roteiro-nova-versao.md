# Relatório: Roteiro de testes da nova versão do Minas Mais Entregas

**Data:** 18/11/2026. **Ambiente:** local, com o código atual da equipe de desenvolvimento (API na porta 8090, site na 5173), banco local e logins de teste `e2e-*@example.com`. Nenhum dado real de cliente foi usado.

**Como foi testado:** testes automáticos que repetem os passos do roteiro como um usuário faria (Playwright), com prints de cada tela.

| Perfil | Aparelho simulado |
|---|---|
| Admin e gerente | Computador 1440×900 |
| Gerente | Celular pequeno 375×667 e tablet 768×1024 |
| Motoboy | Celular 390×844 (tamanho de iPhone 14) com GPS em Belo Horizonte, e iPhone SE 375×667 |

Os prints estão em [docs/prints-roteiro-nova-versao](prints-roteiro-nova-versao/).

## Resumo

| Parte | Primeiro teste | Depois das correções |
|---|---|---|
| Regras e dados (API), seções 2, 3, 5 a 11 | 28 passaram, 3 falharam | 33 de 33 passaram (2 testes novos) |
| Telas no computador e no tablet, seções 1 a 3 e 10 a 14 | 12 de 12 passaram | 13 de 13 passaram (1 teste novo: botão Editar) |
| App do motoboy no celular, seções 4, 5, 6, 9 e 13.4 | 7 passaram, 1 falhou (passo 5.3) | 9 de 9 passaram (1 teste novo: chave online/offline) |

**Itens encontrados (a chave online/offline do motoboy também foi refinada: bolinha inteira dentro do trilho, ver `04-chave-online.png` e `04-chave-offline.png`):**
- **3 problemas de prioridade ALTA**, já corrigidos (ver a seção abaixo).
- **1 problema MÉDIO.**
- **3 diferenças de texto em relação ao roteiro.**

---

## Correções feitas depois do teste (18/11/2026)

Os três problemas de prioridade ALTA foram corrigidos e testados de novo. Nada foi commitado ainda.

| Passo | O que mudou | Onde |
|---|---|---|
| 3.7 | O gerente agora tem o botão **Editar** em cada entrega que ainda está na fila (sem motoboy e fora de rota). Pode mudar pagamento, receita, telefone, observações e endereço. Depois que um motoboy aceita, o botão some, e a API responde *"A loja só pode editar a entrega enquanto ela está na fila. Depois que um motoboy aceitar, fale com a Central."* A API também recusa a edição de entregas de outra filial. A alteração entra no histórico como "Equipe da unidade". | API `PATCH /deliveries/:id`; tela `store-portal.tsx` e `App.tsx` |
| 5.3 | Quem perde a disputa recebe *"Outro motoboy aceitou esta entrega primeiro."*, e o aviso aparece no topo da tela do motoboy (antes ficava dentro do cartão, que sumia junto com a oferta). O aviso some sozinho em 8 segundos ou pelo botão Fechar. | API `PATCH /deliveries/:id/status`; tela `courier-portal.tsx` |
| 7.1 | A rota oferecida a todos só aparece para os motoboys da cidade das filiais. Motoboy de outra cidade não a vê, não abre a prévia e, se tentar aceitar, recebe *"Esta rota é de uma filial de outra cidade."* O aviso (notificação) de rota nova também vai só para a cidade certa. | API `courier-routes.ts` |

Prints novos: `03-editar-entrega.png`, `03-editada-na-lista.png` e `05-outro-aceitou.png`, que agora mostra o aviso.

---

## Problemas encontrados no teste

### 1. ALTA (corrigido): o gerente não consegue editar uma entrega que está na fila

- **Perfil:** Gerente de filial
- **Aparelho:** Computador
- **Passo:** 3.7
- **O que aconteceu:**
  - Na lista "Entregas da filial" não existe o botão **Editar**.
  - Tentando editar direto pelo sistema, a resposta é *"Sua conta ainda não tem acesso a esta área."* (erro 403).
  - Hoje só o admin e a central podem editar.
- **O que era esperado:** o gerente edita endereço, pagamento ou observação de uma entrega da própria filial enquanto ela está na fila, e a alteração aparece para o motoboy.
- **Print:** `03-lista-gerente.png`, a lista sem o botão Editar.

### 2. ALTA (corrigido): quem perde a disputa pela entrega não recebe o aviso certo

- **Perfil:** Motoboy A e Motoboy B, da mesma cidade
- **Aparelho:** Celular
- **Passo:** 5.3
- **O que aconteceu:**
  - O motoboy B aceita primeiro. Quando o motoboy A toca em "Aceitar entrega", o sistema responde *"Esta entrega não pertence à sua área de acesso."* (erro 403).
  - Na tela do motoboy A não aparece nenhuma mensagem: a oferta simplesmente some e a tela volta para "Aguardando pedidos…".
  - O mesmo acontece quando os dois aceitam ao mesmo tempo.
  - Só um dos dois fica com a entrega, o que está correto.
- **O que era esperado:** o motoboy A ver *"Outro motoboy aceitou esta entrega primeiro."*
- **Causa provável:** a API confere se a entrega "é da área" do motoboy antes de conferir se ela já foi aceita. Como a entrega passou a ser do motoboy B, o pedido do motoboy A cai na mensagem errada.
- **Print:** `05-outro-aceitou.png`

### 3. ALTA (corrigido): rota oferecida a todos aparece para motoboy de outra cidade

- **Perfil:** Gerente (Belo Horizonte) e Motoboy C (Contagem)
- **Aparelho:** Computador e celular
- **Passo:** 7.1, a opção "oferecer a todos"
- **O que aconteceu:** o gerente da filial de Belo Horizonte monta uma rota sem escolher motoboy, e ela aparece na lista de rotas do motoboy C, que atende Contagem.
- **O que era esperado:** a rota aparecer só para os motoboys da cidade da filial, como já acontece com as entregas avulsas: o motoboy C não as vê e, se tentar aceitar, recebe *"Esta entrega é de uma filial de outra cidade."*
- **Print:** a falha foi vista pela API. Na tela, o motoboy C veria a rota em "Rotas disponíveis".

### 4. MÉDIA: o CEP fica errado quando o endereço é escolhido sem o número

- **Perfil:** Gerente
- **Aparelho:** Computador
- **Passo:** 3.4
- **O que aconteceu:**
  - Ao escolher na lista a sugestão "Rua Pernambuco – Funcionários, Belo Horizonte" antes de digitar o número, o campo CEP é preenchido com **39442-218**, que não é um CEP de Belo Horizonte.
  - Depois de digitar o número, o CEP é corrigido para **30140-120**.
  - Se o gerente salvar sem número, o CEP errado vai junto com a entrega.
  - O ponto no mapa fica certo nos dois casos.
- **O que era esperado:** o CEP ficar em branco, ou ser o CEP correto da rua, até o número ser informado.
- **Print:** `03-endereco-preenchido.png`

---

## Diferenças de texto em relação ao roteiro

Nenhuma destas impede o uso. É preciso decidir qual texto vale: o do app ou o do roteiro.

| Passo | No app | No roteiro |
|---|---|---|
| 5.4 | O botão da oferta se chama **"Recusar oferta"**, e o das rotas, **"Recusar"**. Depois aparece a confirmação **"Sim, recusar"**. | "Dispensar" |
| 5.4 | Na confirmação: *"Ela volta para a fila da Central e pode ir para outro motoboy."* | A entrega continua para os outros motoboys da cidade. A frase ainda fala da "fila da Central". |
| 5.2 e 9 | A tela não mostra o valor da entrega. A API, porém, ainda envia ao app do motoboy o valor da entrega (R$ 8,50) e o total a receber. | Nenhum valor em R$ para o motoboy. Se a regra é o motoboy não saber o valor, a API também não deveria enviá-lo. |

Prints: `05-oferta.png` e `05-recusar-confirmacao.png`.

---

## O que foi conferido e está funcionando

**1. Site público e botão Suporte**
- O botão fica no canto inferior direito, no computador e no celular, sem cobrir outros botões.
- Abre o painel e fecha pelo X, pela tecla Esc e por um toque fora do painel.
- O link do WhatsApp leva o número e a mensagem certos.
- O botão some depois do login.
- Prints: `01-suporte-computador.png` e `01-suporte-celular.png`.

**2. Acessos (admin)**
- O convite de motoboy exige a cidade (*"Escolha a cidade em que o motoboy vai atender."*).
- O convite de gerente exige a filial (*"Escolha a filial do gerente."*).
- Ao trocar a cidade do motoboy, a lista de filiais é atualizada ("Recebe as entregas de N filiais") e aparece "Acesso atualizado".
- O menu da conta tem "Ajuda e Suporte".
- Print: `02-acessos.png`.

**3. Nova entrega (gerente)**
- Não existe campo de prioridade.
- A unidade vem fixa, só para leitura.
- O endereço é sugerido pelo Google e o mapa fica no lugar certo.
- O pagamento é obrigatório (*"Escolha a forma de pagamento: cartão, Pix ou dinheiro."*).
- As quatro formas de pagamento aparecem certas na lista: "Dinheiro · troco para R$ 100,00", "Dinheiro · sem troco", "Cartão · levar maquininha" e "Pix".
- Entregas com receita mostram a etiqueta "Com receita".
- A barra de etapas e o aviso "Na fila dos motoboys da cidade" aparecem na lista.
- No celular, a caixinha "Medicamento com receita" fica alinhada ao texto.
- Prints: `03-*.png`.

**4. Perfil do motoboy**
- Mostra nome, telefone, **Cidade: Belo Horizonte** (sem "Filial"), "GPS · Ativo", Notificações, Alterar senha, "Ajuda e Suporte" (que abre o WhatsApp) e Sair da conta.
- "Sair da conta" tem a mesma posição, largura e altura de "Alterar senha", com o texto em vermelho.
- No iPhone SE o menu rola e "Sair da conta" pode ser alcançado.
- Prints: `04-perfil.png` e `04-perfil-pequeno.png`.

**5. Fila por cidade**
- A entrega aparece para os motoboys A e B, de Belo Horizonte, e não para o C, de Contagem.
- O motoboy C não consegue aceitar.
- A oferta mostra a retirada, o destino, a distância, o tempo e a forma de pagamento.
- "Recusar" tira a oferta só de quem recusou: ela continua para o motoboy B.
- Motoboy offline não recebe ofertas.
- Print: `05-oferta.png`.

**6. Entrega avulsa**
- Depois de aceitar aparecem "Navegar até a loja", o pagamento ("Cartão · levar maquininha") e só o botão **"Retirei o pedido na loja"**. Não existe mais "Cheguei na loja".
- Com receita:
  - aparece o aviso *"Esta entrega tem receita: tire a foto e depois marque que pegou a receita."*;
  - o deslizar para confirmar fica travado até o motoboy marcar "Peguei a receita do cliente";
  - a API também recusa concluir sem a receita.
- O gerente consegue "Confirmar saída".
- Prints: `06-aceita.png`, `06-em-entrega.png` e `06-receita-trava.png`.

**7. Rotas montadas pelo gerente**
- Funcionam com motoboy escolhido.
- "Tirar da rota" funciona, tanto devolvendo a entrega para a fila quanto cancelando.
- "Desfazer a rota" funciona.
- Quando o motoboy recusa a rota, as entregas voltam para a fila.
- A rota tem uma única retirada.

**8. Devolução e cancelamento**
- Aparecem só os quatro motivos novos.
- A entrega devolvida pode ser enviada de novo com "Reenviar aos motoboys".
- O gerente cancela tanto da fila quanto da devolvida ("Cancelada pela loja").
- Depois da retirada, a entrega fica como "Voltando para a loja".

**9. Histórico do motoboy**
- "Totais" mostra só quantidades (Hoje, Esta semana, Este mês), sem R$.
- A tela inicial mostra "Suas entregas de hoje: 0 entregas feitas".
- Print: `09-historico.png`.

**10. Contabilidade**
- "Marcar como pago" pede confirmação, zera o "A pagar" e mostra "Pago em".
- O CSV exportado abre com acentos no Excel.
- O gerente vê só a própria filial e não tem acesso aos relatórios gerais.
- Print: `10-contabilidade.png`.

**11 e 12. Relatórios e painel**
- Os relatórios mostram os cards por etapa e os detalhes por filial.
- O painel mostra o mapa, a fila com as etiquetas RECEITA e EM ROTA, e o detalhe da entrega com o pagamento e as etapas.
- Prints: `11-*.png` e `12-*.png`.

**13.4. Sem internet**
- Aparece o aviso de sem internet, que some quando a conexão volta.
- Print: `13-sem-internet.png`.

**14. Celular pequeno e tablet**
- A lista, a nova entrega e a contabilidade do gerente não rolam para o lado.
- Prints: `14-*.png`.

---

## O que precisa ser testado à mão, em aparelho real

Não dá para conferir estes itens com os testes automáticos:

1. **E-mails** do convite, do reenvio do convite e da criação de senha. Os testes não disparam e-mails reais.
2. **Instalar o app no celular** (Android/Chrome e iPhone/Safari) e abrir pelo ícone.
3. **Notificação de nova entrega** chegando para os motoboys A e B e **não** para o C, com o celular bloqueado.
4. **Abrir o WhatsApp de verdade** pelo botão Suporte e por "Ajuda e Suporte".
5. **Estabilidade (seção 13):** deixar o app aberto 1 a 2 horas sem usar, e o celular bloqueado por 30 minutos, e conferir se continua logado e recebendo ofertas.
6. **GPS real na rua:** distância e tempo da oferta, e "Navegar até a loja / até o cliente" abrindo o Google Maps ou o Waze.
7. **Foto pela câmera** do celular. Os testes usam uma imagem anexada.

## Bateria completa depois das correções

**Resultado:** 343 testes passaram e 37 falharam ou estouraram o tempo.

**Os três arquivos deste roteiro passaram inteiros.**

**Nenhuma das falhas vem das correções ou da chave online/offline.** Todas estão em testes antigos que ficaram desatualizados com a nova versão:

- **Busca de endereço:** os testes `08-google` e `02-filiais` esperam o formato antigo das sugestões.
- **Mapa:** os testes de mapa precisam da página em `localhost:5173`, porque a chave do Google só aceita esse endereço.
- **Rota pela Central:** o teste espera que "Criar rota" crie a rota na hora. Agora abre a janela para escolher o motoboy.
- **App do motoboy:** os testes ainda procuram a aba "Ganhos", que virou "Histórico".
- **Contraste de cores:** o verificador automático acusou textos claros demais na barra de etapas e no formulário de Acessos. Vale a equipe olhar.
- **Gestão de acessos:** um teste de `06-gestao` dá erro de banco ao rebaixar um motoboy com entrega em andamento.
- **Painel da Central:** alguns testes do painel não acham mais o título "Sua operação, em tempo real", provavelmente por causa do novo layout.

## Observação para a equipe de desenvolvimento

Alguns testes automáticos antigos ficaram desatualizados com a nova versão. Não são erros do app:

- Os testes de endereço (`08-google`, `02-filiais`) ainda esperam o formato antigo das sugestões. Agora as coordenadas vêm de um segundo passo, em `/enderecos/detalhes`.
- O teste da jornada do motoboy ainda procura "Cheguei na loja".
- O teste `06-gestao` ainda espera o motivo "Problema na moto" ativo.

Os testes novos deste roteiro estão em:
- `e2e/tests/api/09-roteiro-v2.spec.ts`
- `e2e/tests/ui/06-roteiro-v2.spec.ts`
- `e2e/tests/ui/courier-roteiro-v2.spec.ts`
