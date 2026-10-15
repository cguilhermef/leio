# Regras de negócio do Leio

Fonte da verdade das regras do produto. Cada regra tem um ID (`RN-xx`), que aparece nos
comentários do código onde ela é aplicada. Para achar todos os lugares de uma regra:

```bash
git grep -n "RN-07"
```

**Antes de mudar uma regra:** leia a regra, as que ela cita em "Interage com" e a seção
[Tensões e decisões em aberto](#tensões-e-decisões-em-aberto). Se a mudança contradiz outra regra
ou cria um caso que nenhuma regra cobre, avise quem pediu **antes** de implementar. Depois
atualize este arquivo, os comentários `RN-xx` e os testes listados.

---

## RN-01 · Páginas totais

Soma de todas as páginas lidas, incluindo releituras (`pagesRead` de cada livro da estante). As
médias por mês e por dia vêm dos registros de leitura (`logs`), do primeiro registro até hoje (ou
até o fim de cada ano, nos anos passados).
**Onde:** `core/stats.ts` (`totalPages`, `readingStats`).
**Testes:** `stats.spec.ts` "soma páginas totais e únicas", "calcula médias por ano".
**Interage com:** RN-03, RN-07.

## RN-02 · Páginas únicas

Maior página alcançada em cada livro, sem contar releituras e limitada ao total de páginas da
estante: `min(maxPage, pages)`.
**Onde:** `core/stats.ts` (`uniquePages`).
**Testes:** `stats.spec.ts` "soma páginas totais e únicas".
**Interage com:** RN-07 (as páginas usadas são as da estante, não as do catálogo).

## RN-03 · Registro de página

- O leitor informa a página em que está. A diferença para o último registro (ou para a página 0,
  no primeiro) vira páginas lidas naquela data.
- A página é limitada ao total de páginas da estante. Ao chegar na última, o livro é marcado
  como lido.
- Registros são fatos gravados: mudanças posteriores no livro não os recalculam. O leitor pode
  apagar um registro ou corrigir a data, e os totais acompanham.
- Ebooks sem número de página (Kindle) convertem a posição em página por regra de três.
- Livro marcado como lido **sem data** não gera registro: não entra nas estatísticas por período.

**Onde:** `core/shelf.service.ts` (`add`, `logPage`, `finish`, `addReread`, `deleteLog`,
`changeLogDate`), `core/stats.ts` (`positionToPage`).
**Testes:** `stats.spec.ts` "converte posição do Kindle em página do impresso".
**Interage com:** RN-01, RN-04, RN-07.

## RN-04 · Meta do ano e meta semanal

- A meta é de **livros** no ano. Contam os livros com uma conclusão no ano que o leitor não
  excluiu da meta. Livros lidos sem data não contam.
- Meta semanal: livros que faltam para a meta do ano. Primeiro entram as páginas restantes dos
  livros em leitura (os mais adiantados primeiro), depois os livros "Lerei" em ordem de inclusão.
  Se faltarem livros, usamos a média de páginas do usuário (ou 250). O total é dividido pelas
  semanas restantes do ano.

**Onde:** `core/stats.ts` (`goalBooks`, `countedForGoal`, `weeklyPlan`), `pages/goal.ts`.
**Testes:** `stats.spec.ts` "lista livros concluídos no ano", "calcula a meta semanal…",
"respeita livros excluídos da meta".
**Interage com:** RN-03, RN-07.

## RN-05 · Limite de usuários

Os primeiros `MAX_USERS` (padrão 50) que entram recebem o custom claim `allowed`. Sem ele, as
functions e as regras recusam o acesso.
**Onde:** function `registerUser`, `requireAllowed`, `firestore.rules`.

## RN-06 · Editores e sugestões de edição

- Quem tem o custom claim `role: 'editor'` (script `npm run editor`) edita livros do catálogo na
  hora.
- Os demais enviam uma **sugestão** (`bookEdits`) só com os campos que mudaram e os valores
  anteriores. A moderação automática (RN-09) aplica, recusa ou deixa a sugestão pendente.
- Um editor aprova (aplicando no catálogo) ou recusa (apagando a capa enviada) as pendentes.
- A sugestão é marcada como revisada numa transação antes de ser aplicada, para que dois
  editores não a apliquem juntos. Se a aplicação falhar, ela volta a ficar pendente.
- O ISBN informado precisa ter dígito verificador válido (ISBN-10 ou ISBN-13), também para
  editores.

**Onde:** functions `editBook`, `reviewBookEdit`, `sanitizeChanges`, `validIsbn`,
`core/edits.service.ts`, `pages/edit-book.ts`, `pages/notifications.ts`, `firestore.rules`
(`/bookEdits`).
**Interage com:** RN-07, RN-09, tensões 2 e 3.

## RN-07 · Cópia do livro na estante

- Ao entrar na estante, o livro leva uma cópia de título, autores, capa e páginas do catálogo.
- Título, autores e capa **acompanham o catálogo**: editar o livro atualiza todas as estantes e
  indicações.
- As **páginas são da edição de cada leitor**. O leitor ajusta as da própria estante, e uma
  mudança de páginas no catálogo **não reescreve** o que já foi lido: ela só chega às estantes
  em "Lerei" que ainda têm a contagem anterior do catálogo.

**Onde:** `core/shelf.service.ts` (`add`, `setPages`), `functions/src/index.ts` (`SHELF_FIELDS`,
`applyBookEdit`).
**Decidido em:** 15/10/2026. Antes, aprovar uma mudança de páginas reescrevia todas as estantes,
alterando as páginas únicas e a meta semanal de quem já tinha lido o livro.
**Interage com:** RN-02, RN-03, RN-04, RN-06, tensão 1.

## RN-08 · Leitura de fotos com IA

- A capa e a ficha catalográfica são lidas por um modelo da OpenAI (parâmetro `OPENAI_MODEL`,
  padrão `gpt-5-mini`), com resposta em JSON estruturado.
- Cada usuário tem até `AI_DAILY_LIMIT` (padrão 40) leituras por dia, para controlar custos.

**Onde:** functions `identifyCover`, `readCatalogCard`, `consumeAiQuota`, `extractFromImage`.
**Interage com:** RN-09 (cada sugestão de edição também consome uma unidade do limite diário).

## RN-09 · Moderação automática das sugestões

Vale para quem não é editor, em duas etapas:

1. **Moderação da OpenAI** (`omni-moderation-latest`, gratuita) no texto alterado e na capa nova.
   Se marcar conteúdo impróprio, a sugestão é **recusada**: a capa enviada é apagada e o usuário
   vê o motivo.
2. **Revisão pelo modelo** (`OPENAI_MODEL`), que recebe os valores antes e depois e a capa nova.
   Correção ou complemento legítimo do mesmo livro é **aplicado na hora**. Qualquer dúvida (troca
   por outro livro, texto sem sentido, propaganda, dados pessoais, imagem que não é capa ou não
   combina com o título, mudança grande de páginas) deixa a sugestão **pendente** para um editor,
   com o motivo.

- Se a moderação ou a revisão não responderem, a sugestão fica pendente (na dúvida, vai ao
  editor).
- Toda sugestão fica registrada em `bookEdits`, com `status`, `aiReason` e `reviewedBy: 'ai'`
  quando a decisão foi automática.

**Onde:** functions `editBook`, `moderateEdit`, `isFlagged`, `reviewWithAi`, `askModel`;
`pages/notifications.ts` (motivo exibido ao editor).
**Decidido em:** 15/10/2026, para não depender de um editor em cada correção.
**Interage com:** RN-06, RN-07, RN-08, RN-10, tensões 2 e 7.

## RN-10 · Moderação de livros novos

- O app cadastra livros direto no Firestore. Logo depois, um gatilho passa o texto (título,
  subtítulo, autores, editora, edição) e a capa, separadamente, pela moderação da OpenAI
  (`omni-moderation-latest`, gratuita, sem consumir o limite da RN-08).
- **Capa imprópria:** a capa é removida do livro e da estante de quem cadastrou, e o arquivo é
  apagado do Storage.
- **Texto impróprio:** o livro é apagado do catálogo, junto com a entrada na estante e os
  registros de leitura de quem cadastrou.
- Cada decisão fica em `moderationLog` (sem acesso pelo app). Se a moderação não responder, o
  livro fica como está.

**Onde:** function `moderateNewBook`, `isFlagged`; `core/catalog.service.ts` (`create`).
**Decidido em:** 15/10/2026.
**Interage com:** RN-03, RN-09, tensão 6.

---

## Tensões e decisões em aberto

Casos em que duas regras puxam para lados diferentes, ou em que foi preciso escolher sem uma
definição explícita. Revise esta lista ao mudar qualquer regra citada.

1. **Catálogo compartilhado × histórico pessoal (RN-06 × RN-02/RN-03/RN-04).** Resolvido em
   15/10/2026 pela RN-07: correções de páginas no acervo não reescrevem o que o leitor já leu.
   **Risco que continua:** quem adicionou o livro com a contagem errada e já começou a ler
   precisa ajustar as páginas na própria estante; o app não avisa que o catálogo mudou.
2. **Conteúdo impróprio em edições (RN-06 × RN-09).** Resolvido em 15/10/2026 pela moderação
   automática. **Risco que continua:** a IA pode aprovar uma alteração errada mas inofensiva
   (por exemplo, um número de páginas plausível porém incorreto). A comparação com Google Books
   ainda não é feita.
3. **Edição que vale na hora para quem editou (RN-06 × RN-07).** Proposta: a edição grava
   personalizações na estante de quem editou e vira sugestão para o acervo. Como as conexões veem
   a estante (`firestore.rules`, `/shelf`), as personalizações não revisadas teriam que aparecer
   só para o dono. Ainda não implementado.
4. **Página atual acima do total.** Se o leitor reduz as páginas da estante abaixo de
   `currentPage`/`maxPage`, esses campos não são ajustados. As páginas únicas ficam corretas pelo
   `min` (RN-02), mas a página atual fica acima do total até o próximo registro.
5. **Livro lido sem data (RN-03 × RN-04).** Não conta para a meta nem para as estatísticas por
   período, mesmo que tenha sido lido no ano.
6. **Moderação de livro novo depois do cadastro (RN-10).** Como o app grava o livro direto, a
   moderação roda segundos depois: nesse intervalo o livro aparece na busca. A remoção também
   não avisa quem cadastrou (o livro ou a capa somem da estante). Se o gatilho rodar antes de o
   livro entrar na estante, a entrada fica órfã. A moderação de livros novos não usa a revisão
   pelo modelo, então uma capa inofensiva mas errada passa.
7. **Edição aplicada pela IA sem desfazer (RN-09).** O valor anterior fica guardado em
   `bookEdits.before`, mas ainda não há tela para o editor ver as edições aplicadas
   automaticamente nem para desfazê-las.
