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

## Installazione

Al prompt di una sessione nel terminale:

```
/plugin install barra-sessione --marketplace <tuo-utente>/claude-mods
```

Rispondi `y` per aggiungere il marketplace, poi scegli lo scope utente.

Da una shell:

```
claude plugin install barra-sessione --marketplace <tuo-utente>/claude-mods
```

Nell'app desktop, dove `/plugin` non funziona: clicca + accanto alla casella, poi Plugins, Add marketplace con `<tuo-utente>/claude-mods`, poi Add plugin.
