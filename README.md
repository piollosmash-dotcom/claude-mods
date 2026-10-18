# claude-mods

Mod personali di Claude Code.

## barra-sessione

Una riga di stato in italiano sopra la casella dei messaggi:

- **cache**: quanto manca prima che scada (stima: 1 ora con un abbonamento sotto i limiti, 5 minuti con la chiave API o oltre il limite), verde / giallo / rossa;
- **contesto**: token occupati e percentuale della finestra;
- **limiti** delle 5 ore e della settimana, con il tempo al rinnovo;
- **token** totali della sessione e **costo** a prezzi API;
- pulsanti **Handoff** (riassunto, `/clear`, riassunto nella casella come bozza) e **Replay** (se è installato replay-theater, apre `/replay`).

Il comando `/token` mostra lo stesso riepilogo per esteso.

## handoff

Quando la chat inizia a saturarsi, un clic e riparti da zero senza perdere il filo:

- pulsante **Handoff** sopra la casella (scorciatoia `h`), con la percentuale di contesto occupata: verde, gialla da 50%, rossa da 75%;
- scrive un prompt di passaggio di consegne (dove eravamo, decisioni, file chiave, stato, prossimi passi, domande aperte), fa `/clear` e lo mette nella casella come bozza: lo rileggi e premi Invio;
- `/handoff` fa lo stesso da comando; `/handoff ultimo` rimette nella casella l'ultimo handoff salvato.

`barra-sessione` ha già un suo pulsante Handoff: se le installi tutte e due vedrai due pulsanti.

## Installazione

Al prompt di una sessione nel terminale:

```
/plugin install barra-sessione --marketplace piollosmash-dotcom/claude-mods
/plugin install handoff --marketplace piollosmash-dotcom/claude-mods
```

Rispondi `y` per aggiungere il marketplace, poi scegli lo scope utente.

Da una shell:

```
claude plugin install barra-sessione --marketplace piollosmash-dotcom/claude-mods
```

Nell'app desktop, dove `/plugin` non funziona: clicca + accanto alla casella, poi Plugins, Add marketplace con `piollosmash-dotcom/claude-mods`, poi Add plugin.
