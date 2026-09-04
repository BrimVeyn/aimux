# aimux — Plugin Kernel : plan d'implémentation

Un noyau de plugins in-process façon DeepSeek Harness (contexte, injection,
effets réversibles, rechargement à chaud), avec la couche déclarative et
« le CLI est l'API » d'herdr comme second étage. Deux moitiés par plugin, une
par processus hôte.

Basé sur aimux 1.23.7 (`main @ b7da8b5`, 2026-09-01). Décisions tranchées le
2026-09-01, voir la section 10.

## Sommaire

1. [État des lieux](#1-état-des-lieux)
2. [Les deux modèles](#2-les-deux-modèles-et-ce-quon-en-garde)
3. [Architecture cible](#3-architecture-cible)
4. [Surface d'API](#4-surface-dapi--le-contexte-par-processus)
5. [Live refresh](#5-live-refresh)
6. [Refactos requises](#6-refactos-requises-par-ordre-de-dépendance)
7. [Plan par phases](#7-plan-par-phases)
8. [« Un plugin en un prompt »](#8--un-plugin-en-un-prompt---ce-que-le-skill-doit-contenir)
9. [Risques](#9-risques-et-parades)
10. [Décisions](#10-décisions)

---

## 1. État des lieux

aimux a déjà plusieurs registres _data-driven_ (sections de réglages, commandes
CLI, widgets de barre) et un seul point de chargement de code utilisateur :
l'`import()` de `aimux.config.ts` dans `src/config/loader.ts`. Tout le reste est
fermé par des unions TypeScript et des `switch`.

| Registre                 | Où                                                   | Forme actuelle                         | Verrou                                                                 |
| ------------------------ | ---------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Assistants / adaptateurs | `src/pty/command-registry.ts:210`                    | `ASSISTANT_OPTIONS[]`                  | union `BuiltinAssistantId` ; `customCommands` ne porte qu'une commande |
| Détecteur de statut      | `src/pty/assistant-status-detector.ts:142`           | `switch(assistant)`                    | tables regex inline par CLI                                            |
| Widgets de barre         | `src/ui/widgets/registry.tsx`, `src/state/bars.ts:7` | `WIDGET_RENDERERS`, `KNOWN_WIDGET_IDS` | ids inconnus purgés dans `sanitizeBars`                                |
| Vues plein écran         | `src/ui/root.tsx:424`                                | chaîne `if / else if` sur `focusMode`  | aucun registre                                                         |
| Modales                  | `src/ui/root.tsx:101`, `types.ts:349`                | `switch` à 25 branches, union fermée   | props bag figé                                                         |
| Modes clavier            | `types.ts:11`, `transitions.ts`, `bridge.ts`         | union de 30 `ModeId`                   | transitions exhaustives, 3 tables de dérivation, labels d'aide         |
| Actions / SideEffects    | `types.ts:891/906`, `side-effects.ts:220`            | unions fermées, `switch` à 68 branches | dupliqués à la main entre le package et `src/`                         |
| Slices du store          | `src/state/store.ts:150`                             | chaîne ordonnée de 10 reducers         | `AppState` plat, 24 clés                                               |
| Thèmes                   | `packages/aimux-config/src/tui/registry.ts`          | 34 imports JSON statiques              | pas de chargement disque                                               |
| Serveur de hooks         | `src/integrations/claude-hook-server.ts`             | une route, un vendeur                  | —                                                                      |
| Usage IA                 | `src/services/ai-usage/provider.ts`                  | `switch(tool)`, 2 adaptateurs          | union `AIUsageTool`                                                    |
| Réglages                 | `src/settings/sections/index.ts`                     | `SETTING_SECTIONS` (13)                | **déjà ouvert** : à copier comme modèle                                |
| Commandes CLI            | `src/cli/registry.ts:38`                             | `COMMANDS[]` + complétion générée      | **déjà ouvert**                                                        |
| Skills                   | `src/cli/commands/worker/doctor.ts:68`               | un chemin relatif codé en dur          | aucun registre                                                         |

Trois seams existants sont directement réutilisables :

- la config : `loadUserConfig` est déjà le loader de code utilisateur ;
- l'instrumentation `countAction` / `countEffect` dans
  `src/services/aimux-counters/observe.ts`, appelée à chaque dispatch et
  chaque side effect, donc un bus d'événements en attente ;
- le `SideEffectContext` de `src/app-runtime/side-effect-context.ts`,
  exactement l'objet de capacités qu'un plugin UI a besoin de recevoir.

> **Bug trouvé en chemin.** `package.json` publie `src`, `skills`, `README`,
> `LICENSE` mais pas `assets/`. `resolveHookScriptPath()` ne sonde que
> `assets/claude-hooks/`, donc l'intégration `claudeHooks` se dégrade
> silencieusement en détection visuelle sur une installation npm. À corriger
> en phase 0, indépendamment du reste.

## 2. Les deux modèles et ce qu'on en garde

### herdr : déclaratif, hors-processus, « le CLI est l'API »

- Manifeste `herdr-plugin.toml` : `id`, `version`, `min_herdr_version`, puis
  des tableaux `[[actions]]`, `[[events]]`, `[[panes]]`, `[[link_handlers]]`,
  `[[build]]`, `[[startup]]`, chacun pointant sur une `command`.
- Chaque action est un sous-processus ; l'hôte injecte `HERDR_SOCKET_PATH`,
  `HERDR_BIN_PATH`, `HERDR_PLUGIN_CONTEXT_JSON`, les répertoires `ROOT` /
  `CONFIG_DIR` / `STATE_DIR`.
- Placement de panes (`overlay`, `popup`, `split`, `tab`), keybindings vers des
  actions qualifiées `plugin.id.action`, install/link depuis GitHub,
  marketplace par topic.
- Skill `skills/herdr/SKILL.md` livré dans le dépôt, imprimable via
  `herdr --skill`.
- Pas de rechargement à chaud en v1, pas de sandbox, pas d'API de stockage.

### DeepSeek Harness : tout est plugin, noyau Cordis

- Un plugin est un module qui exporte `name`, `inject` (services requis) et
  `apply(ctx)`. Les services vivent sur `ctx` (`ctx.tools`, `ctx.llm`…) ; un
  plugin attend que ses dépendances existent.
- Machine à états par plugin (_fiber_) : `PENDING → LOADING → ACTIVE`,
  `FAILED`, `UNLOADING → DISPOSED`. Toute inscription faite via `ctx` est
  annulée au déchargement (`ctx.on`, `ctx.effect(() => dispose)`).
- Événements à cinq modes de dispatch : `emit`, `parallel`, `serial`, `bail`,
  `waterfall` (chaîne de `next()`, court-circuitable).
- HMR : éditer un plugin le décharge, le recharge et rejoue `apply`. Comme les
  inscriptions se nettoient d'elles-mêmes, rien ne fuit.
- Paquets « à deux moitiés » (host + browser) et un sous-système _extensions_
  où le modèle définit, exécute et retire des paquets dynamiques en mémoire.

### Synthèse retenue

Le **noyau** vient de Cordis : contexte, injection, effets réversibles,
événements typés, fibers, HMR. La **forme de distribution** vient d'herdr :
manifeste déclaratif, répertoires config/state, `install` / `link`, skill dans
le dépôt, et un adaptateur « commandes » pour écrire un plugin dans n'importe
quel langage en s'appuyant sur le CLI `aimux` existant. Le découpage en deux
moitiés répond à l'architecture trois-processus d'aimux.

## 3. Architecture cible

Un plugin peut contribuer à l'UI (widgets, vues, modales, actions, réglages,
thèmes) et au daemon (assistants, détecteurs, hooks, requêtes IPC, commandes
CLI). Le terminal manager ne charge jamais de plugin : c'est le processus qui
tient les PTY, et sa stabilité est la garantie de survie des sessions.

```
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
│ App UI                   │   │ Daemon                   │   │ Terminal manager │
│                          │   │                          │   │                  │
│ PluginKernel (ui)        │   │ PluginKernel (daemon)    │   │ PTY + émulateurs │
│  widgets · views · modals│   │  assistants · détecteurs │   │ (inchangé)       │
│  actions · keymaps       │   │  hooks HTTP · événements │   │                  │
│  settings · themes       │   │  requêtes IPC · CLI      │   │ aucun plugin,    │
│  store · toasts          │   │                          │   │ par règle        │
│                          │   │ Plugin built-in aimux.exec│  │                  │
│ Watcher fs → dispose +   │   │  (manifestes herdr,      │   │                  │
│  re-import               │   │   sous-processus AIMUX_*)│   │                  │
└────────────┬─────────────┘   └────────────┬─────────────┘   └──────────────────┘
             │  IPC v19, capacité pluginRpc │        daemon ⇄ TM : inchangé
             └──────────────────────────────┘
```

### Anatomie d'un plugin

```
my-plugin/
  aimux-plugin.json      # manifeste : lu sans exécuter de code
  ui.ts                  # moitié UI  : export default definePlugin({...})
  daemon.ts              # moitié daemon (optionnelle)
  package.json           # deps du plugin (bun install au link/install)
  README.md
```

```jsonc
// aimux-plugin.json
{
  "id": "acme.telegram-notify",
  "name": "Telegram notify",
  "version": "0.1.0",
  "minAimuxVersion": "1.24.0",
  "apiVersion": 1,
  "entries": { "ui": "./ui.ts", "daemon": "./daemon.ts" },
  "build": [["bun", "install"]],
  "config": { "botToken": { "type": "string", "secret": true } },
  // optionnel : plugin « exec » façon herdr
  "commands": [
    { "id": "ping", "title": "Ping", "command": ["node", "ping.js"], "contexts": ["tab"] },
  ],
}
```

```ts
// daemon.ts
import { definePlugin } from '@brimveyn/aimux-plugin'

export default definePlugin({
  inject: ['tabs', 'events'],
  apply(ctx) {
    ctx.on('tab:turnComplete', async ({ tabId }) => {
      const tab = ctx.tabs.get(tabId)
      await notify(ctx.config.botToken, `${tab?.title} a fini son tour`)
    })
    ctx.effect(() => {
      const t = setInterval(poll, 60_000)
      return () => clearInterval(t)
    })
  },
})
```

Le manifeste porte tout ce que l'hôte doit connaître _avant_ d'exécuter le
code : quelles moitiés existent (donc quel processus recharger), la version
d'API, le schéma de config (donc les lignes de réglages générées), les
commandes exec. Les entrées TS sont chargées par `import()` comme
`aimux.config.ts` aujourd'hui : Bun exécute le TS, pas de build.

### Emplacements et découverte

- `<profil>/plugins/<id>/` : installés (checkout géré) ;
  `<profil>/plugins-state/<id>/` : état runtime ;
  `<profil>/plugins-config/<id>/` : fichiers éditables.
- `<profil>/aimux-plugins.json` : registre écrit par la machine (liens locaux,
  enabled, config par plugin, versions).
- `aimux.config.ts` :
  `plugins: ['./local/plugin', { id: 'acme.x', enabled: false, config: {...} }]`
  pour la voie déclarative.
- Isolation par profil, comme les sockets : le profil `dev` a ses propres
  plugins.

## 4. Surface d'API : le contexte par processus

Un seul package public, `@brimveyn/aimux-plugin`, dans `packages/`. Il exporte
`definePlugin`, les types `UiContext` et `DaemonContext`, et
`createTestContext()` pour les tests des plugins.

| Service                                                                                          | Processus | Ce qu'il expose                                                                                  | Branché sur                                                     |
| ------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `ctx.log`, `ctx.config`, `ctx.paths`, `ctx.effect`, `ctx.on/emit`                                | les deux  | socle Cordis : journal par plugin, config typée par schéma, répertoires, disposers, événements   | nouveau `src/plugins/kernel`                                    |
| `ctx.rpc`                                                                                        | les deux  | `call('verb', payload)` vers l'autre moitié, `handle('verb', fn)`, `broadcast`                   | enveloppe `pluginRpc` IPC                                       |
| `ctx.ui.widgets`                                                                                 | ui        | `register({ id, label, render(width) })` : placement, resize, menu contextuel gratuits           | `WIDGET_RENDERERS` devenu dynamique                             |
| `ctx.ui.views`                                                                                   | ui        | vue plein écran remplaçant l'arbre de panes, avec son mode clavier                               | `root.tsx` → registre                                           |
| `ctx.ui.modals`                                                                                  | ui        | `open({ id, render, onKey })` ; une seule variante `plugin-modal` dans l'union                   | `modal-state.ts`                                                |
| `ctx.actions`                                                                                    | ui        | `register('verb', (ctx) => KeyResult)` ; utilisable dans `keymaps` via `k.plugin('acme.x.verb')` | variantes génériques `plugin-action` / `plugin-effect`          |
| `ctx.keymaps`                                                                                    | ui        | bind / unbind par mode, modes `plugin.<id>.<mode>`                                               | `resolver.ts`, `transitions.ts`, `bridge.ts`, `help-entries.ts` |
| `ctx.settings`                                                                                   | ui        | `registerSection(section)` avec les `SettingRow` existants ; section générée depuis le schéma    | `SETTING_SECTIONS`                                              |
| `ctx.themes`, `ctx.stats.pages`, `ctx.statusBar`, `ctx.contextMenu`, `ctx.toast`, `ctx.snippets` | ui        | enregistrements réversibles                                                                      | registres respectifs                                            |
| `ctx.store`                                                                                      | ui        | slice namespacée `state.plugins[id]`, reducer et sélecteurs ; `ctx.app.state` en lecture         | chaîne de reducers                                              |
| `ctx.tabs`, `ctx.projects`, `ctx.workspaces`                                                     | les deux  | lecture, `spawn`, `send`, `focus`, `tail`, `snapshot`                                            | backend / tabRegistry du daemon                                 |
| `ctx.assistants`                                                                                 | daemon    | `register({ id, command, model?, session?, detectStatus?, extractQuestion?, usage?, hooks? })`   | `ASSISTANT_OPTIONS`, détecteur, arbitre, usage IA               |
| `ctx.hooks`                                                                                      | daemon    | `route('/hook/<plugin>', handler)` + injection d'env par PTY                                     | `claude-hook-server.ts`, `daemon.ts:856`                        |
| `ctx.cli`                                                                                        | daemon    | `register({ group, verb, flags, run })` ; complétion générée                                     | `src/cli/registry.ts`                                           |
| `ctx.events`                                                                                     | daemon    | `tab:status`, `tab:turnComplete`, `tab:question`, `project:*`, `workspace:*`, `daemon:reexec`    | broadcasts existants                                            |

Règle de conception : toute API du contexte retourne un disposer ou est
enregistrée via `ctx.effect`. C'est ce qui rend le rechargement à chaud sûr
par construction, pas par discipline.

## 5. Live refresh

1. `fs.watch` récursif sur chaque plugin lié (`plugin link`) ; debounce 150 ms.
2. Le manifeste dit quelles moitiés ont changé. Le kernel concerné passe la
   fiber en `UNLOADING`, rejoue tous les disposers, puis `DISPOSED`.
3. Réimport avec invalidation du cache module (voir le spike de phase 0),
   nouvelle fiber, `apply`. Les registres UI bumpent une version dans le
   store : React re-rend.
4. Côté daemon, le rechargement ne touche ni la socket ni le TM : aucune PTY
   n'est affectée, aucun client ne se reconnecte. Un plugin qui lève à
   l'`apply` reste en `FAILED` avec son erreur affichée en toast et dans
   `aimux plugin log`.
5. `aimux plugin reload [id]` déclenche le même chemin à la main. Le hot-reexec
   du daemon (`runtime/daemon.handoff.json`) n'a rien à sérialiser : le
   successeur relance simplement le loader.

Le même mécanisme s'étend naturellement à `aimux.config.ts`, qui n'est
aujourd'hui jamais rechargé : keymaps et snippets deviennent live-refresh par
la même occasion.

## 6. Refactos requises, par ordre de dépendance

### R1 · Types partagés

`packages/aimux-config/src/types.ts` annonce que ses types « doivent rester
structurellement identiques » à ceux de `src/state/types.ts`,
`src/input/modes/types.ts`, `src/state/layout-tree.ts`. Un package public de
plugins ne peut pas être bâti sur une duplication manuelle. Faire de
`packages/aimux-config` la source unique (ré-export côté `src/`), ou extraire
un `packages/aimux-types`. C'est le seul refacto « ennuyeux » mais il
conditionne la stabilité de l'API.

### R2 · Ouvrir les unions sans les casser

- `AppAction` et `SideEffect` : ajouter deux variantes génériques
  `{ type: 'plugin-action', pluginId, actionId, payload }` et
  `{ type: 'plugin-effect', … }`. Les unions restent fermées,
  `switch-exhaustiveness-check` reste satisfait.
- `ModeId` : `BuiltinModeId | \`plugin.${string}\``. `transitions.ts`obtient
une règle par défaut pour les modes plugin (vers/depuis`navigation`, plus ce
que le plugin déclare). `bridge.ts`gagne un point d'extension`deriveModeId`. `HELP_MODE_LABELS` lit le registre.
- `FocusMode` : une valeur `plugin-view` avec `activePluginView: string` dans
  l'état.
- `ModalState` : une variante `plugin-modal`.
- `AppState` : une clé `plugins: Record<string, unknown>` +
  `pluginRegistryVersion: number`.

### R3 · Registres dynamiques

- Widgets : `KNOWN_WIDGET_IDS` devient `getKnownWidgetIds()` ; `sanitizeBars`
  conserve les ids inconnus en état _orphelin_ (masqués, non purgés) pour
  survivre à un plugin désactivé. `DEFAULT_BARS` accepte les placements
  déclarés par le plugin.
- Vues, modales, stats pages, sections de réglages, thèmes, pages d'aide :
  chacun devient un module `registry.ts` avec `register()` qui retourne un
  disposer. Les built-ins s'enregistrent au boot par le même chemin.
- Reducers : `appReducer` appelle en dernier `reducePluginSlices`, qui route
  sur `state.plugins[id]`.
- Assistants : `ASSISTANT_OPTIONS` → `assistantRegistry` ; l'objet
  d'adaptateur absorbe `classifyBuiltin` (map d'`AssistantId` vers
  classifieur), l'extracteur de questions, l'adaptateur d'usage IA et le
  mapping de hooks. L'arbitre passe de deux sources à N.
- Serveur de hooks : `POST /hook/:plugin` avec table de routes ; Claude
  devient la première route enregistrée.
- CLI : `COMMANDS` reste un tableau, plus un `registerCliCommand()` ; la
  complétion lit la liste fusionnée. Les commandes de plugin transitent par le
  daemon (le processus CLI ne charge pas de plugin).

### R4 · Bus d'événements unifié

Remplacer les appels directs à `countAction` / `countEffect` par un
`appEvents.emit('action', a)` dont les compteurs deviennent un abonné. Côté
daemon, les broadcasts `tabStatus`, `tabTurnComplete`, `tabQuestion`, cycle de
vie projet/workspace émettent aussi sur le bus local avant l'envoi IPC. Le
kernel branche `ctx.on` dessus.

### R5 · Config et IPC

- `AimuxUserConfig.plugins`, `aimux-plugins.json`, `StoredSettings` par plugin
  (préfixe `plugin.<id>.`).
- Protocole IPC : v19, `MIN` inchangé, capacité `pluginRpc`, deux types de
  message opaques validés une seule fois (`pluginId`, `verb`,
  `payload: unknown`). Aucun plugin ne bumpe jamais le protocole.
- Le `HooksConfig.onProjectCreate` déclaré et jamais appelé : le câbler sur le
  bus, il devient le premier hook « legacy » compatible.

### R6 · Hygiène

- `max-lines: 1000` (oxlint) : `daemon.ts` (1429) et `root.tsx` (547) vont
  grossir ; extraire `daemon/plugin-host.ts` et `ui/plugin-host.tsx` dès le
  départ.
- knip : ajouter `src/plugins/**` et `packages/aimux-plugin/src/index.ts` aux
  entrées.
- `check-protocol-discipline.ts` : nouvelle règle « aucun import de
  `src/plugins` depuis `src/terminal-manager` ».

## 7. Plan par phases

Chaque phase se termine mergeable, tests verts, sans plugin externe requis.
Les durées supposent une personne à plein temps plus des workers aimux pour
les migrations mécaniques.

### Phase 0 · Spikes et prérequis (≈ 1 semaine)

**Livrable :** décision technique sur le rechargement de module, package
skeleton, bug `assets/` corrigé.

1. Spike : invalider le cache ESM de Bun pour un fichier modifié. Candidats :
   `import(path + '?v=' + mtime)`, copie vers `<state>/.hot/<hash>.ts`, ou
   `Bun.build` vers un blob. Critère : rechargement < 200 ms, pas de fuite
   mémoire visible après 100 cycles.
2. Spike : rendre un composant React fourni par un module chargé dynamiquement
   dans opentui (contexte React partagé, pas de double instance de `react`).
   Le plugin doit importer `react` et `@opentui/react` résolus depuis aimux :
   documenter la résolution (`peerDependencies` + `bun link` ou un alias de
   résolution dans le loader).
3. Créer `packages/aimux-plugin` (types vides, `definePlugin`, README),
   l'ajouter au workspace et à knip.
4. Corriger `package.json` `files` (ajouter `assets`) et le test associé.
5. Écrire la RFC courte dans `docs/developer/plugins.md` à partir de ce
   document, y figer l'`apiVersion: 1`.

### Phase 1 · Kernel, loader, config, CLI (≈ 2 semaines)

**Livrable :** un plugin « hello » chargé dans l'UI et le daemon, rechargé à
chaud, listé et journalisé par le CLI. Aucun registre ouvert encore.

1. `src/plugins/kernel/` : `Fiber` (états, transitions, erreurs), `Context`
   (services, `inject` avec attente, `effect`, `plugin()` enfant), `EventBus`
   (5 modes), `ServiceRegistry` (provide / retrait déclenchant l'unload des
   dépendants).
2. `src/plugins/manifest.ts` : parse et validation d'`aimux-plugin.json`,
   semver contre `minAimuxVersion` et `apiVersion`.
3. `src/plugins/loader.ts` : découverte (répertoire du profil,
   `aimux-plugins.json`, `config.plugins`), résolution des moitiés, import
   isolé (try/catch → `FAILED`), journal par plugin dans
   `<state>/<id>/plugin.log`.
4. `src/plugins/watch.ts` : watcher + debounce + reload ; désactivable par
   `AIMUX_PLUGIN_WATCH=0`.
5. Hôtes : `src/ui/plugin-host.tsx` (monté dans `app.tsx` après
   `registerAllModes`) et `src/daemon/plugin-host.ts` (après
   `startClaudeHookServer`). Contexte minimal : `log`, `config`, `paths`,
   `effect`, `on`, `rpc`.
6. IPC v19 : `pluginRequest` / `pluginEvent`, capacité `pluginRpc`, routage
   daemon → handler, broadcast → moitiés UI.
7. Config : `plugins` dans `AimuxUserConfig` et le resolver ;
   `aimux-plugins.json` avec validation par champ comme `loadConfigResult`.
8. CLI : `aimux plugin list | link | unlink | install <owner/repo[/subdir]> |
uninstall | enable | disable | reload | log | doctor`. `install` = clone +
   prévisualisation du manifeste + `build` après confirmation, comme herdr.
9. Tests : unitaires kernel (cycle de vie, disposers, inject en attente, HMR
   sans fuite), intégration loader avec un plugin fixture dans
   `test/fixtures/plugins/`, roundtrip IPC `pluginRpc`.

### Phase 2 · Ouvrir l'UI et l'input (≈ 3 semaines)

**Livrable :** un plugin peut ajouter un widget de barre, une vue plein écran,
une modale, des actions liées au clavier, une section de réglages, un thème,
une page de stats.

1. R1 (types partagés) en premier : c'est la fondation du package public.
2. R2 : variantes `plugin-action` / `plugin-effect`, `ModeId` ouvert,
   `plugin-view`, `plugin-modal`, slice `plugins`.
3. R3 UI : registres widgets, views, modals, settings, themes (avec chargement
   disque depuis `<profil>/themes/`, comme les sprites), stats pages, status
   bar, aide.
4. Keymap builder : `k.plugin('acme.x.verb')` et modes plugin dans
   `KeymapBuilderApi` ; l'aide générée affiche les bindings des plugins.
5. R4 : bus d'événements UI ; compteurs migrés en abonné.
6. Kit de primitives pour plugins : `Panel`, `List`, `KeyHint`, `Row`, thème
   via hook, pour qu'un plugin ait la même allure que le reste sans apprendre
   opentui.
7. Tests : rendu d'un widget plugin dans une barre, transition vers un mode
   plugin, reducer de slice, help entries.

### Phase 3 · Ouvrir le daemon (≈ 2 semaines)

**Livrable :** un plugin peut déclarer un assistant complet, réagir aux tours
et questions, recevoir des hooks HTTP, ajouter une commande CLI, ou n'être
qu'un manifeste de commandes.

1. R3 daemon : `assistantRegistry`, map de classifieurs, arbitre N sources,
   adaptateurs d'usage IA, routes de hooks, `registerCliCommand`.
2. `ctx.tabs` / `ctx.projects` / `ctx.workspaces` côté daemon sur le
   `tabRegistry` et le backend.
3. Plugin built-in `aimux.exec` : interprète `manifest.commands`,
   `manifest.events`, `manifest.panes` ; lance les sous-processus avec
   `AIMUX_SOCKET_PATH`, `AIMUX_BIN_PATH`, `AIMUX_PLUGIN_ID`,
   `AIMUX_PLUGIN_ROOT/CONFIG_DIR/STATE_DIR`, `AIMUX_CONTEXT_JSON`,
   `AIMUX_ENV=1`. Les panes « overlay / popup / split / tab » se traduisent en
   tabs aimux existants.
4. Règle de discipline : `src/terminal-manager` n'importe jamais
   `src/plugins`.
5. Tests : assistant custom de bout en bout (reprend
   `test/integration/custom-assistants.test.ts`), route de hook, commande CLI
   de plugin visible dans la complétion.

### Phase 4 · Dogfooding, skill, docs (≈ 2 semaines)

**Livrable :** quatre fonctionnalités existantes sont des plugins built-in, le
skill d'auteur est livré, la doc utilisateur et développeur existe.

1. Migrer vers `src/builtin-plugins/` : `claude-integration` (hooks, syntax
   overlay, theme sync), `ai-usage`, `auto-commit`, `auto-rename`. Le widget
   `setup` ensuite. Git et projets restent cœur.
2. Chaque migration est un test de l'API : ce qu'une migration ne peut pas
   faire proprement est un trou d'API à combler avant de continuer.
3. Skill `skills/aimux-plugin-author/` (section 8), commande
   `aimux plugin new <id> [--ui] [--daemon] [--exec]`,
   `aimux --skill plugin-author`.
4. Docs : `docs/guide/plugins.md` (utilisateur), `docs/developer/plugins.md`
   (architecture), `docs/reference/plugin-api.md` (généré depuis les `.d.ts`
   par un script `scripts/gen-plugin-api-doc.ts`).
5. Dépôt `aimux-plugin-examples` : trois plugins (notification Telegram,
   layout bootstrap, lien GitHub), miroir des exemples herdr.

### Phase 5 · Extensions optionnelles (à décider)

- **Panes non-terminal** : `LayoutLeaf` gagne `kind: 'tab' | 'plugin'`. Touche
  ~15 call sites (`layout-tree.ts`, `tab-state.ts`,
  `use-terminal-resize.ts`…). Utile pour un board, un diff, un navigateur de
  logs à côté d'un agent.
- **Plugins dynamiques définis par un agent** (DeepSeek « extensions ») :
  `aimux plugin define --from-file` crée un plugin en mémoire, vivant jusqu'au
  redémarrage. Un worker aimux pourrait s'ajouter un widget de suivi pendant
  sa tâche.
- **Marketplace** : index par topic GitHub `aimux-plugin` + manifeste à la
  racine, page sur le site de docs.
- **Isolation** : moitié daemon dans un `Worker` Bun pour qu'une boucle
  infinie ne gèle pas le daemon.

## 8. « Un plugin en un prompt » : ce que le skill doit contenir

Un skill ne remplace pas une API prévisible. Le kit qui rend l'objectif
réaliste tient en six pièces, toutes livrées par le dépôt aimux et versionnées
avec lui.

- **`skills/aimux-plugin-author/SKILL.md`** : préflight
  (`aimux plugin doctor`), boucle d'auteur (`new → link → reload → log`),
  règles d'API (tout est réversible, pas d'état global, pas de protocole IPC),
  checklist de sortie (types, tests, README, manifeste).
- **`references/api.md`** : généré depuis les `.d.ts` de
  `@brimveyn/aimux-plugin` à chaque release. Un agent qui lit une API à jour
  ne devine pas.
- **`references/recipes.md`** : dix recettes courtes couvrant chaque service
  (widget, vue, modale, action + keybinding, section de réglages, assistant,
  détecteur de statut, hook HTTP, commande CLI, plugin exec).
- **`references/manifest.md`** : schéma JSON du manifeste avec exemples valides
  et invalides.
- **`assets/`** : template de plugin (les trois formes), template de test avec
  `createTestContext()`.
- **`aimux plugin doctor <path>`** : valide le manifeste, importe les moitiés à
  sec, vérifie les types via `tsc --noEmit` sur le plugin, liste les
  inscriptions faites par `apply`. Le message d'erreur nomme le champ et la
  ligne : c'est ce que l'agent lit en boucle.

Le skill existant `aimux-orchestrator` est le modèle de forme (frontmatter,
references, assets) et `worker doctor` le modèle de résolution de chemin.
Ajouter un petit registre de skills à `doctor.ts` pour ne plus coder un chemin
par skill.

## 9. Risques et parades

| Risque                                                        | Impact                                        | Parade                                                                           |
| ------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| Bun ne permet pas d'invalider proprement un module ESM        | pas de HMR, seulement « reload = restart UI » | spike phase 0 ; repli : copie hashée du fichier, ou rechargement via `Bun.build` |
| Double instance de React / opentui dans un plugin             | hooks cassés, rendu vide                      | résolution forcée vers les modules d'aimux ; `doctor` détecte le cas             |
| Dérive entre les types dupliqués package / `src`              | API publique instable                         | R1 avant toute publication                                                       |
| Un plugin daemon bloque la boucle                             | toutes les UI figées, PTY vivantes            | timeouts sur les handlers, `FAILED` après N erreurs, phase 5 Worker              |
| Fichiers > 1000 lignes, knip, discipline protocole            | CI rouge                                      | hôtes extraits dès la phase 1, entrées knip, règle TM                            |
| Sécurité : le code du plugin tourne avec les droits de l'user | comme herdr                                   | prévisualisation à l'install, `--yes` explicite, pas de sandbox promise          |
| Surface d'API trop large trop tôt                             | rétro-compat impossible                       | `apiVersion`, tout ce qui n'est pas dogfoodé en phase 4 reste `@experimental`    |

## 10. Décisions

Tranché le 2026-09-01. Les quatre premiers points suivent la recommandation ;
les deux derniers restent des hypothèses du plan, à revoir en phase 5.

1. **Modèle d'exécution : les deux.** TS in-process comme voie principale
   (seule façon d'avoir du rendu UI et du HMR), l'adaptateur exec comme plugin
   built-in pour la voie herdr.
2. **Rendu UI : React/opentui direct, avec un kit de primitives.** Un DSL
   déclaratif serait plus stable mais rend un « board » ou un « diff »
   impossible.
3. **Dogfooding : claude-integration, ai-usage, auto-commit, auto-rename.** Le
   panneau git reste cœur : trop lié aux reducers pour un premier passage.
4. **Distribution v1 : GitHub `owner/repo[/subdir]` + `link` local.** npm plus
   tard si des plugins ont des dépendances lourdes.
5. _Hypothèse :_ pas de panes non-terminal dans l'arbre de layout en v1 ; les
   vues plein écran et les widgets de barre couvrent la plupart des cas avec
   dix fois moins de call sites.
6. _Hypothèse :_ moitié daemon in-process avec timeouts ; l'API RPC est conçue
   pour qu'un passage en Worker soit invisible pour les plugins.

---

# Phase 6 · Ce qu'il reste, et dans quel ordre

Écrit le 2026-09-02, après les phases 0-5 et les quatre plugins d'exemple.
Les phases précédentes disaient ce qu'on allait construire ; celle-ci part de
ce qui a résisté.

## 6.1 Où en est le passage des features natives

| Feature                   | État                                                    |
| ------------------------- | ------------------------------------------------------- |
| Thème Claude + hooks      | **plugin** (`aimux.claude`)                             |
| Indicateur d'usage IA     | **plugin** (`aimux.ai-usage`) — tuile + polling         |
| Overlay de syntaxe Claude | cœur — transformation par frame dans le chemin de rendu |
| Pages stats usage/quotas  | cœur — lues par l'écran stats, pas par le plugin        |
| `auto-commit`             | cœur — état dans `AppState`, rendu par le panneau git   |
| `auto-rename`             | cœur — lit le flux d'octets PTY brut                    |
| Widget `setup`            | cœur — son id est dans le `bars` des utilisateurs       |
| Git (mode, panneau, diff) | cœur, **et doit le rester** — voir 6.4                  |

Deux migrations complètes, deux partielles, trois refusées pour des raisons
nommées. Le point de la phase 4 était de prouver l'API, pas de vider `src/` :
chaque migration a bouché un trou, et les trois refus sont chacun bloqués sur
une chose précise plutôt que sur de l'effort.

## 6.2 Le seul vrai bloqueur : publier le paquet

`@brimveyn/aimux-plugin` n'est pas sur npm. Conséquence : un plugin hors de ce
dépôt ne peut pas `bun install` sa dépendance, donc `aimux plugin doctor`
rapporte `types.ok: false` pour tout le monde, tout le temps. Le noyau marche,
le scaffold marche, la boucle d'auteur marche — et le premier retour que reçoit
un auteur est rouge.

**À faire avant tout le reste.** Publier `@brimveyn/aimux-plugin` (et
`@brimveyn/aimux-config`, dont il dépend en types), figer `apiVersion: 1`, et
ajouter au release script une étape qui régénère `docs/reference/plugin-api.md`
et refuse de publier si le test de dérive échoue.

Coût : petit. Impact : c'est la différence entre « un système de plugins » et
« un système de plugins que quelqu'un d'autre peut utiliser ».

## 6.3 Ce qui manque pour écrire les plugins qu'on veut écrire

Les quatre exemples ont buté sur ceci, par ordre décroissant de gêne.

1. **Un pane ne prend pas le clavier.** Un pane de stats qu'on ne peut pas
   faire défiler est à moitié utile. La correction est nommée depuis la phase
   5 : un `activePaneId` distinct d'`activeTabId`, et un mode clavier par
   pane comme les vues plein écran en ont déjà un. ~10 call sites, tous dans
   `tab-state` et `raw-input-handler`. **Le prochain morceau à faire.**
2. **Un plugin ne peut pas naviguer aimux.** Ouvrir le mode git, l'écran
   stats, une modale native : rien. Un `ctx.ui.navigate('git' | 'stats' |
'settings')` étroit couvrirait le besoin réel sans exposer les ids de
   modales — qui deviendraient de l'API le jour où on les expose.
3. **Un widget ne connaît que sa largeur.** La hauteur est devinée. Passer
   `{ cols, rows }` à `render` plutôt qu'un nombre.
4. **Pas de test de rendu pour un plugin.** `createTestContext` couvre
   `apply`/`dispose`, pas « est-ce que ça dessine ». aimux a un test renderer ;
   l'exposer via `@brimveyn/aimux-plugin/testing` rendrait les tests de widget
   possibles hors du dépôt.

## 6.4 Git : ce qui doit bouger et ce qui ne doit pas

Le mode git n'est pas un point d'extension, c'est l'application : un écran, un
renderer de diff, une file de commandes, un panneau PR, ~40 fichiers. Le
transformer en plugin ferait de l'API plugin l'API interne d'aimux — exactement
ce que `apiVersion: 1` promet de ne pas faire.

Ce qui vaut la peine d'être ouvert _dans_ git, en revanche :

- **un fournisseur de message de commit** : `ctx.ui.git.suggestCommitMessage`.
  C'est ce dont `auto-commit` a besoin pour migrer, et c'est une demande réelle
  de tiers (« que mon plugin écrive les messages de commit »).
- **un événement `git:workingTreeChanged`** et un `ctx.git.status(repoRoot)`
  en lecture seule, pour tout plugin qui réagit au dépôt.
- **un fournisseur de PR**, plus tard, si quelqu'un veut GitLab.

Autrement dit : `auto-commit` migre en _ouvrant une fente_, pas en déplaçant du
code. C'est le bon ordre — la fente est utile même si `auto-commit` ne bouge
jamais.

## 6.5 Les trois migrations restantes, et ce qu'elles coûtent

**`auto-rename`** — la plus rentable. `ctx.tabs.rename` **est fait** : un
plugin pose un titre par le même chemin qu'aimux (`applyTabMetadata` →
manager, session, toutes les UI), donc il ne peut pas produire un titre
qu'aimux lui-même ne pourrait pas.

Reste `tab:prompt`, et il y a une contrainte que le plan n'avait pas vue : la
reconstruction d'un prompt à partir des frappes vit dans l'état par onglet du
`AutoRenameCoordinator`, qui n'existe que pour les onglets `eligible`. Émettre
l'événement depuis `acceptPrompt` donnerait un `tab:prompt` qui se tait dès
qu'un onglet a été renommé — un demi-événement. Le faire proprement veut dire
sortir `PromptCapture` du coordinateur pour en faire un observateur par onglet
indépendant d'auto-rename, puis émettre. C'est le vrai périmètre : ~1 jour, et
c'est ce qui rend l'événement honnête pour tout le monde, pas seulement pour le
plugin qui le remplace.

**`auto-commit`** — dépend de 6.4. Une fois la fente ouverte, le plugin possède
son état dans sa slice, et le panneau git affiche ce qu'un fournisseur lui a
donné. Sans la fente, c'est un déplacement d'état vers nulle part.

**Widget `setup`** — annulé. Le plan disait « bloqué sur un alias d'id » ; en
regardant le code, il dessine le viewport d'un PTY caché (`TerminalViewport`,
`usePaneSizeReport`, `runSideEffectGlobal`, `findSetupTab`). Un plugin ne peut
pas rendre un terminal, et il ne devrait pas y avoir d'API pour ça — ce serait
l'API interne d'aimux sous un autre nom. L'alias d'id reste une bonne idée le
jour où une vraie migration en a besoin ; le construire sans utilisateur ne
l'était pas.

**Overlay de syntaxe** — demande une cascade _synchrone_ (`waterfall` est
async, le chemin de rendu ne l'est pas). Un canal de transformation sync sur le
bus, ~20 lignes. À faire seulement si quelqu'un veut décorer le viewport ; sinon
l'overlay est très bien là où il est.

## 6.4 bis · La fente est faite (2026-09-03)

`ctx.ui.git.provideCommitMessage`, plus `ctx.ui.git.status()` et l'événement
`git:workingTreeChanged`. Une seule fente, premier arrivé ; décliner retombe
sur la suggestion d'aimux ; et un fournisseur remplace l'appel au modèle **et
ses prérequis** — auto-commit ne refuse plus faute de `claude` dans le PATH.

Reste la migration d'`auto-commit` elle-même, qui a maintenant où poser son
état. Et la fente vaut déjà sans elle, ce qui était l'argument pour la faire
d'abord.

## 6.5 bis · `auto-rename` a migré (2026-09-03)

Troisième built-in, et le premier qui éprouve l'API **daemon** plutôt que
l'UI : il réagit à un événement, décide, appelle un modèle et écrit le titre
d'un onglet, sans accès privilégié à aucun des trois.

Ce qui est resté à aimux, c'est ce qu'un onglet _est_ : son titre, et le fait
que quelqu'un l'ait nommé ou non. Ce qui est parti, c'est chaque décision sur
comment l'appeler.

Il a fallu quatre choses, dont aucune n'appartient à auto-rename :
`ctx.tabs.rename` (déjà là), `tab:prompt` (son propre refactor), `tab:renamed`
et `tab:closed` (un nommeur doit s'arrêter quand un autre a nommé, et lâcher ce
qu'il tient quand l'onglet part), et `PluginTabView.unnamed` — le
`autoRenameStatus` d'aimux sous un nom qui décrit l'onglet et non la feature.

`autoRenameStatus` lui-même n'a pas bougé : il est dans l'entrée d'onglet, sur
les protocoles IPC et terminal-manager, et dans la session persistée. Le
déplacer dans le plugin aurait été une migration de protocole déguisée en
migration de plugin.

## 6.5 ter · `auto-commit` a migré (2026-09-03)

Pas la feature : sa phrase. Ce qui fait d'auto-commit une feature reste à
aimux — quand ça se déclenche, le hash qui dit qu'une suggestion est périmée,
l'abandon qui supplante une génération en vol, le panneau où elle s'affiche.
Ce qui part, c'est l'appel au modèle : le gabarit de briefing, la composition
du prompt, l'invocation headless, l'analyse de la réponse.

`aimux.auto-commit` tient la fente par le même `ctx.ui.git.provideCommitMessage`
qu'un plugin tiers, sans chemin privilégié — la seule façon de rendre la fente
croyable, un built-in qui tricherait ne prouvant rien.

Ça a imposé une règle dans la fente : **des rangs**. Un built-in enregistré au
démarrage gagne à tous les coups une fente « premier arrivé », donc aucun plugin
installé par l'utilisateur ne pourrait jamais la tenir. Un plugin utilisateur
déplace maintenant le built-in et la lui rend au déchargement ; deux plugins
utilisateur restent un refus.

Le driver a perdu son propre appel au modèle dans l'échange : il n'y a plus de
second chemin, et un fournisseur qui décline veut dire « pas de suggestion cette
fois » plutôt qu'un repli sur quelque chose qu'aimux garderait en réserve.

## 6.6 Ordre proposé

1. Publier le paquet (6.2). Rien d'autre ne compte tant que c'est faux.
2. Clavier dans les panes (6.3.1).
3. Sortir `PromptCapture` du coordinateur, puis `tab:prompt`, puis migration
   `auto-rename` (`tabs.rename` est déjà là).
4. Fente « message de commit » (6.4) + migration `auto-commit`.
5. Le reste de 6.3 au fil des demandes.

Les trois autres chantiers de la phase 5 — isolation Worker, `plugin define`,
marketplace — restent non commencés et non planifiés ici : aucun des quatre
plugins d'exemple n'en a eu besoin, ce qui est la meilleure indication qu'on a
sur leur urgence.

---

# Phase 7 · Une interface de contrôle des plugins

Planifié le 2026-09-02 par un agent qui a lu tout le code du noyau, du CLI et
de l'écran de réglages. Trois parties : activer/désactiver n'importe quel
plugin (y compris ceux livrés), les configurer, et une surface où faire les
deux.

## 7.0 Ce qui existe déjà, et ce qui manque discrètement

| Pièce                                   | État                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| `resolvePluginConfig` (précédence)      | fait, correct, testé                                        |
| `redactPluginConfig`                    | fait                                                        |
| `buildPluginSettingSection`             | **écrit, testé, et jamais appelé par l'app**                |
| `docs/guide/plugins.md`                 | affirme déjà que les lignes de réglages sont générées. Non. |
| activer/désactiver un built-in          | `aimux.config.ts` seulement                                 |
| état des plugins hors React             | aucun — `app.tsx` jette le retour de `usePluginHost`        |
| une config qui atteint un plugin vivant | **corrigé le 2026-09-02** (voir 7.1 ci-dessous)             |

Autrement dit la partie 2 est à moitié construite sur le mauvais stockage, et
le blocage de la partie 1 est un trou de modèle de données, pas un trou d'UI.

## 7.1 Le bug qui rendait la partie 2 morte-née — corrigé

Le noyau ne reconstruisait une fibre que si le plugin avait _bougé sur le
disque_. Une valeur de config modifiée était invisible : `plugin set` puis
`plugin reload` ré-importait le module et lui redonnait les anciennes valeurs.
Corrigé — `recordChanged` couvre maintenant `root`, la version et la config.

C'est aussi la réponse à « comment une écriture atteint un plugin qui tourne » :
en reconstruisant sa fibre. `apiVersion: 1` n'a pas d'API d'abonnement et les
plugins déstructurent `ctx.config` ; muter en place laisserait la moitié d'entre
eux périmés sans que rien ne puisse le détecter.

## 7.2 Décisions

**D1 — Stockage : un bloc `overrides` dans `aimux-plugins.json`.**

```jsonc
{
  "plugins": [
    /* inchangé : où est le code — link/install */
  ],
  "overrides": { "aimux.claude": { "enabled": false } },
}
```

`plugins[]` répond « où est le code », `overrides` répond « comment
l'utilisateur l'a réglé » — et c'est keyé par id, donc ça marche pour un
built-in, un lien, une install ou une entrée de config, identiquement.
L'asymétrie est supprimée à la racine plutôt que rustinée dans chaque verbe.

Précédence complète : `manifest default ← BuiltinPlugin.config ← ligne de
registre ← overrides ← aimux.config.ts`.

_Rejeté_ : une ligne `source: 'builtin'` dans `plugins[]` — `discovery.ts` fait
`existsSync(root)` sur chaque ligne et signalerait « répertoire disparu » pour
un plugin qui n'en a pas.

**D2 — La vue de gestion est une section de l'écran de réglages, plus une
modale.** Un écran neuf coûterait des arms sur `FocusMode`, `BuiltinModeId`, la
table `TRANSITIONS`, un handler de mode, des en-têtes d'aide, deux `AppAction`,
un `SideEffect`, un réducteur, un composant et un raccourci — pour une liste
avec un interrupteur et des valeurs, ce qui est exactement le métier de l'écran
de réglages. Ce que cet écran ne peut pas faire, c'est afficher une stack et un
extrait de log : ça justifie **une** modale.

**D3 — Une troisième valeur de `storage` : `'plugin'`.** `storage: 'settings'`
écrit dans le bloc `settings` d'`aimux.json`, que la découverte ne lit jamais —
une valeur écrite là n'atteindrait silencieusement aucun plugin. C'est
précisément ce que `plugin-section.ts` produit aujourd'hui, et pourquoi il n'est
branché nulle part.

## 7.3 Le CLI, pour un agent

| L'agent veut…                      | Il tape                                          |
| ---------------------------------- | ------------------------------------------------ |
| lister avec la config              | `aimux plugin list`                              |
| basculer un plugin                 | `aimux plugin disable aimux.claude`              |
| poser une valeur                   | `aimux plugin set acme.telegram quietMinutes 15` |
| savoir pourquoi un plugin a échoué | `aimux plugin show acme.telegram`                |

`list` gagne `state`, `error`, `enabledFrom` (`default | registry | config`) —
c'est `enabledFrom` qui dit à l'agent si son `disable` va tenir ou être
outrepassé par `aimux.config.ts` au prochain lancement. `set` coerce selon le
type déclaré et **refuse** une clé inconnue : `resolvePluginConfig` la
laisserait passer, et une faute de frappe qui ne fait rien est le pire résultat
possible pour un agent. `--value-stdin` évite qu'un token entre dans
l'historique du shell.

Contrat de codes de sortie : `0` l'écriture a eu lieu ou la lecture a réussi —
**y compris daemon injoignable** ; `2` id inconnu / clé inconnue / type refusé ;
`3` écriture du registre impossible ; `4` jamais.

## 7.4 Deux bugs latents à corriger en chemin

- **Un secret est affiché par la ligne qui le montre.** `row-value.tsx` ne
  renvoie le placeholder que si la valeur est vide, donc un secret _avec_ une
  valeur s'imprime — dans la ligne, dans le pied de page, et
  `settings-actions.ts` amorce la modale d'édition avec `String(current)`. À
  corriger à `readRow` **et** à `openField`. Latent aujourd'hui parce que
  `plugin-section.ts` n'est pas branché ; actif dès qu'il le sera.
- **Une ligne numérique écrit à chaque frappe.** `←`/`→` appelle `writeRow` par
  pression ; sans anti-rebond, maintenir `→` sur un `pollSeconds` redémarre la
  fibre soixante fois.

## 7.5 Laissé dehors, exprès

Éditer `aimux.config.ts` depuis l'UI ou le CLI (tout le modèle de précédence
repose sur ce fichier comme étant _celui écrit à la main_) ; chiffrer les
secrets (ils restent du JSON en clair, la rédaction est de l'hygiène anti
regard par-dessus l'épaule) ; un écran dédié ; les opérations en lot ;
l'activation par projet.

## 7.6 Sur les configs des plugins d'exemple

Déjà fait : les quatre en déclarent une (`shifter` cinq vitesses, `sysload`
`pollSeconds`/`gpuCommand`, `ghstreak` `refreshMinutes`/`preferGithub`, `pulse`
`days`). Ils deviennent le jeu de test de cette phase — cinq champs `string`, un
`number` avec un plancher, un `boolean`, et rien de secret, ce qui laisse un
trou à combler : aucun exemple n'a de champ `secret`, et c'est le seul dont le
rendu peut fuiter.

---

# Phase 8 · Un plugin en un prompt, à chaud

Planifié le 2026-09-03, à partir d'une question qui est la bonne mesure du
projet et non un cas d'usage parmi d'autres :

> Je lance une session Claude, je lui dis « reproduis le plugin shifter ».
> Est-ce qu'il va au bout — code, keybinds, placement dans l'interface — sans
> redémarrer aimux et sans mon aide ?

Réponse aujourd'hui : **non**. Le noyau tient (link à chaud, reload à chaud,
config à chaud, désinstallation totale), mais tout ce qui _raccorde_ un plugin
à l'interface passe encore par un fichier que l'humain écrit à la main et par
un redémarrage. Un agent finit avec du code correct que personne ne voit.

## 8.0 Ce que l'agent peut faire, et où il bute

Vérifié dans le code et sur le profil `dev`, où `aimux-examples.sysload` est
lié et sa moitié daemon `active`.

| Étape                               | État                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| échafauder (`plugin new`)           | ✅                                                               |
| `bun install` dans le scaffold      | ❌ `@brimveyn/aimux-plugin` n'est pas publié (404 npm)           |
| lier, valider (`link`, `doctor`)    | ✅ `doctor` rend les `registrations` réelles                     |
| charger dans une TUI qui tourne     | ✅ `link` → daemon `refresh` → broadcast → `runtime.refresh()`   |
| recharger sur sauvegarde            | ✅ watcher + fibre                                               |
| lire/écrire sa config               | ✅ `plugin config` / `set` / `unset`                             |
| **tuile de status bar**             | ✅ auto-rendue — `useStatusBarSegments` dessine tout le registre |
| **widget de barre**                 | ❌ aucun chemin de placement (8.1)                               |
| **keybinding**                      | ❌ `aimux.config.ts` + redémarrage (8.2)                         |
| **ouvrir un pane**                  | ❌ dépend d'un keybinding, donc idem                             |
| **vérifier que ça s'affiche**       | ❌ rien ne le dit hors de l'écran (8.4)                          |
| savoir sur quel profil tourne l'app | ❌ deviné par `AIMUX_PROFILE` (8.5)                              |

Les trois trous, dans le détail, parce que chacun a une cause différente :

**T1 — Un widget de barre n'a aucun chemin de placement.**
`registerBarWidget` appelle `registerWidgetId`, qui rend l'id _dessinable_ ;
mais une barre ne dessine que ce qui est listé dans `aimux.json`
`bars[side].widgets`, et rien ne l'y met. Il n'existe pas d'action
`add-widget` — le réducteur ne connaît que `toggle-widget` et `move-widget`,
qui opèrent sur un widget _déjà placé_ — et le menu contextuel n'offre que
`Show` pour un widget placé-mais-caché. `getKnownWidgetIds()` n'a **aucun
appelant** : c'est le symptôme, la fonction a été écrite pour un menu « ajouter »
qui n'existe pas. Enfin `aimux.config.ts` n'a pas de champ `bars` du tout, donc
le snippet des READMEs de `sysload` et `ghstreak` ne fait rien. Constat de
terrain : `sysload` est lié depuis des jours sur le profil `dev` et son widget
n'a jamais pu s'afficher.

**T2 — Un keybinding coûte un redémarrage, et un plugin ne peut pas en
proposer.** `loadUserConfig()` est appelé une fois (`index.tsx`), et
`app.tsx` fait `setActiveKeymap` + `registerAllModes` dans un `useMemo([])`.
Le registre de modes est pourtant une `Map` mutable et le keymap actif une
simple référence : la relecture à chaud est à portée, ce n'est pas un mur
d'architecture. Côté manifeste, `contributes` n'existe pas — un plugin déclare
`entries`, `config`, `build`, `commands`, et rien qui touche l'interface.

**T3 — L'agent est aveugle.** `plugin show` donne l'état de la fibre, pas
celui de l'écran. Aucun moyen de demander « le widget est-il visible », « à
quoi résout `<leader>+` », ni de déclencher une action de plugin sans clavier
(`plugin exec` lance les commandes sous-processus du manifeste, pas les
actions UI). Un agent qui ne peut pas vérifier ne peut pas boucler, et un
agent qui ne boucle pas rend du code qu'il croit fini.

## 8.1 Décisions

**D1 — `contributes` dans le manifeste : le plugin _propose_, l'utilisateur
_dispose_.**

```jsonc
{
  "contributes": {
    "bars": [{ "widget": "load", "side": "left", "position": "end", "grow": 30 }],
    "keymaps": [{ "mode": "navigation", "key": "<leader>+", "action": "up" }],
  },
}
```

Ids non qualifiés, comme partout ailleurs : l'hôte préfixe. C'est ce qui rend
la tâche de l'agent atteignable — il écrit un fichier, dans le répertoire du
plugin, qu'il possède déjà.

La précédence est celle qu'on a déjà, avec un cran de plus en bas :
`contributes ← aimux.json (placement de l'utilisateur) ← aimux.config.ts`. Un
défaut de plugin ne réécrit jamais un choix humain, et **la décision 7.5 tient :
ni le CLI ni un plugin n'écrivent `aimux.config.ts`.**

**D2 — Ce qu'un plugin pose porte sa marque.** Une entrée placée par
`contributes` est persistée avec son origine (`placedBy: "plugin"`). Un unlink
retire ce que le plugin avait posé et laisse ce que l'utilisateur avait bougé ;
sans cette marque, la seule alternative honnête serait de ne rien nettoyer.
Corollaire : une entrée que l'utilisateur a déplacée ou cachée perd la marque —
elle est devenue sa décision, et un reload ne doit pas la ramener.

**D3 — Une couche de keymap dynamique, pas une relecture du fichier.**
`registerKeymapLayer(pluginId, modes)` empile des bindings au-dessus du
`ResolvedKeymapConfig` résolu, reconstruit les handlers des modes touchés et
republie le keymap actif ; la fibre tient le disposer. Recharger
`aimux.config.ts` à chaud serait un autre chantier (il exporte des fonctions,
des thèmes, des snippets) et n'est pas nécessaire ici : le fichier de
l'utilisateur reste la couche du dessus, lue au démarrage.

**D4 — Le CLI devient l'œil de l'agent, pas une deuxième UI.** On ajoute des
lectures et _un_ déclencheur, rien qui duplique l'écran de réglages.

**D5 — L'objectif est un eval, pas une impression.** Tant que « reproduis
shifter » n'est pas une suite qu'on lance, « est-ce que ça marche » restera une
question d'opinion. La phase se termine sur ce test, pas sur les fonctionnalités.

## 8.2 Chantiers, par ordre de dépendance

**C0 · Publier (débloque tout le reste, ne dépend de rien).**
`@brimveyn/aimux-plugin` sur npm, et un aimux publié qui embarque le noyau —
le binaire global actuel (1.23.7) ne connaît pas le groupe `plugin` et part
lancer la TUI. En attendant, `plugin new` détecte qu'il tourne depuis un
checkout et écrit une dépendance résolvable (`bun link` ou chemin workspace)
plutôt qu'un `^0.1.0` qui n'existe pas.

**C1 · Keymap à chaud.** `registerKeymapLayer` + disposer + reconstruction des
handlers concernés. Tests : deux plugins qui lient la même touche (le dernier
chargé perd, et le log le dit), unload qui rend la touche, `aimux.config.ts`
qui gagne toujours.

**C2 · Placement à chaud.** Action `add-widget` (réducteur, persistance,
bornes de `grow`), plus l'entrée « Add widget → » du menu contextuel qui liste
enfin `getKnownWidgetIds()` non placés. Le trou de T1 se rebouche là même s'il
n'y avait pas de plugin.

**C3 · `contributes`.** Validation dans `manifest.ts` (mêmes messages nommés
par champ que le reste : `contributes.bars[0].side`), application au load par
la fibre via C1 et C2, marque `placedBy` de D2. `doctor` rend ce que le
manifeste propose **et** ce que l'hôte en a fait — c'est la même exigence que
`registrations`.

**C4 · Les yeux du CLI.**

| L'agent veut…                      | Il tape                                      |
| ---------------------------------- | -------------------------------------------- |
| voir ce que l'écran montre         | `aimux ui state`                             |
| savoir à quoi résout une touche    | `aimux keymap resolve '<leader>+'`           |
| déclencher une action sans clavier | `aimux action run aimux-examples.shifter.up` |

`ui state` : barres, widgets visibles avec leur origine, panes ouverts, mode
actif, segments de status bar. `keymap resolve` : l'action et d'où vient le
binding (`config | plugin | défaut`) — c'est le pendant d'`enabledFrom`, qui a
déjà prouvé son utilité en phase 7. `action run` passe par le daemon jusqu'à la
moitié UI ; c'est aussi ce qui rend `pulse.open` testable sans toucher un
clavier.

**C5 · Le profil, deviné correctement.** Un `plugin link` sans `AIMUX_PROFILE`
regarde quelles instances tournent : une seule → c'est celle-là ; plusieurs →
refus avec la liste, jamais un lien silencieux dans `default` pendant que la
TUI tourne en `dev`. Plus `aimux profile list --running`, une ligne pour
l'agent au début de sa session.

**C6 · Réparer ce qui ment.** Les READMEs de `sysload` et `ghstreak` (le
snippet `bars:` ne marche pas), le skill (`bun install` qui échoue), et la
section « Trying one » d'`examples/README.md` qui s'arrête avant l'étape où
l'on voit quelque chose.

**C7 · L'eval « reproduis shifter ».** Une session non interactive, le prompt
nu, et des assertions sur l'état final : plugin lié et `active`, tuile visible,
`<leader>+` résolvant vers son action, `action run` qui change la vitesse, zéro
redémarrage, zéro intervention. Le critère de fin de phase, et le seul.

## 8.2 bis · Avancement

| Chantier                          | État                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| C0 · publier                      | **fait** — v1.25.1, `@brimveyn/aimux-plugin@0.1.2` sur npm      |
| C1 · keymap à chaud               | fait — `registerKeymapLayer`, insertion dans le trie vivant     |
| C2 · placement à chaud            | fait — `add-widget`, `remove-plugin-widget`, menu « Add »       |
| C3 · `contributes`                | fait — validé, appliqué, retiré, et les 4 exemples l'utilisent  |
| C4 · les yeux du CLI              | fait — `ui state`, `keymap resolve`, `action run`               |
| C5 · profil deviné                | fait — `profile list`, adoption du seul profil qui tourne       |
| C6 · réparer ce qui ment          | fait — READMEs, doc, skill, et le test que le scaffold générait |
| C7 · l'eval « reproduis shifter » | **à moitié** — voir 8.4                                         |

## 8.4 Ce que C7 couvre, et ce qu'il ne couvre pas

`test/integration/plugin-agent-loop.test.ts` fait tourner la boucle complète
sans personne : un plugin arrive sur le disque avec un `contributes`, et le
test vérifie — à travers les trois fonctions mêmes dont `ui state`,
`keymap resolve` et `action run` sont les façades — qu'il est placé, dessinable,
lié, déclenchable et réversible. Zéro édition de config, zéro redémarrage.

Ce qu'il ne couvre pas : **l'agent qui écrit le plugin**. Cette moitié-là est un
prompt, pas une assertion, et la faire tourner en CI voudrait dire une session
non interactive facturée à chaque push. Le reste de C7 est donc un harnais
optionnel (`claude -p` + le prompt nu + les mêmes assertions), pas une porte de
CI — et il faut le dire plutôt que de laisser croire que la case est cochée.

Un bug trouvé en vérifiant C0, et corrigé au passage : `createTestContext`
n'offrait aucune moitié UI hors d'aimux, donc le test que `plugin new`
échafaude, contre la moitié qu'il échafaude, plantait à la première ligne. Le
premier `bun test` d'un auteur était un rouge qu'il n'avait pas écrit.
Invisible depuis ce repo, où tous les tests passent `extend` avec les vrais
services.

## 8.5 · Le reste de la liste (2026-09-03)

Fait dans la foulée : `ctx.ui.navigate`, la hauteur d'un widget passée à
`render` en second argument (additif — la largeur a été publiée comme un nombre
sous `apiVersion: 1`), `@brimveyn/aimux-plugin/testing` pour tester le rendu
hors du dépôt, `tab:prompt` avec l'observation sortie d'auto-rename, et le
flake `scrollViewport` qui attend maintenant la sortie plutôt qu'une horloge.

`scripts/eval-plugin-agent.ts` est le harnais de 8.4 : le prompt nu, puis des
assertions sur ce qu'un agent peut se tromper tout seul — le plugin existe, le
manifeste valide, `doctor` charge les deux moitiés, et les touches sont
déclarées plutôt que laissées dans une phrase disant d'éditer
`aimux.config.ts`. Hors CI, exprès : il dépense une session par exécution, et
une suite qui coûte de l'argent à chaque push est une suite qu'on désactive.

Une trouvaille en chemin : `scripts/` n'est pas dans l'`include` du tsconfig, donc
`bun run check` ne le vérifie pas et le lint type-aware y voit `any`. L'y
ajouter révèle des erreurs préexistantes dans `bench-pty-pipeline` et
`manual-reexec-test` — un chantier à part, pas un effet de bord de celui-ci.

## 8.3 Laissé dehors, exprès

Recharger `aimux.config.ts` à chaud (D3) ; un `contributes` qui poserait des
thèmes ou des réglages d'écran (les surfaces existantes suffisent) ; laisser un
plugin réserver une touche contre l'utilisateur ; un pilotage d'écran plus large
que les trois verbes de C4 — le CLI doit rester l'œil de l'agent, pas devenir
une seconde interface à maintenir.

# Phase 9 · Accueillir une bibliothèque

Planifiée le 2026-09-03, à partir d'une mesure extérieure plutôt que d'une
envie : herdr a une bibliothèque de plugins publique, et la question n'est pas
« notre API est-elle belle » mais **« ces plugins-là, on saurait les
héberger ? »**

Méthode : la marketplace de `herdr.dev/plugins` est rendue côté client, donc
l'index a été pris à la source — le topic GitHub `herdr-plugin`, **954 dépôts**
au 2026-09-03 (le site en annonce 919 sur 903 dépôts), dont les 120 premiers
par étoiles ont été dépouillés un par un.

## 9.0 Les neuf familles, et ce qu'aimux en ferait

| Famille                              | Exemples herdr                                                                                       | Chez nous                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Un pane qui héberge un programme** | file-viewer, sidebar, lazygit, yazi, nvim, ghzinga, gitview, jira, linear, browser, floax, hunk      | ❌ `ui.panes` ne rend que du React ; aucun leaf PTY appartenant à un plugin                                     |
| **Layout et workspaces pilotables**  | spreader, sessionizer, resurrect, drovr, pane-mover, worktrunk, jj-workspace, zoxide, session-parker | ⚠️ `tabs.spawn/focus/close` seulement ; ni split ni move ni zoom, et `workspaces` est en lecture seule          |
| **Hors-processus longue durée**      | remote, mobile-relay, connect, collie, watch, herdres, push, telemetry                               | ⚠️ `commands[]` est un argv one-shot avec timeout de 600 s ; pas de service supervisé, pas de flux d'événements |
| **Introspection agent / session**    | agent-quota, token-dashboard, memex, catchup, agent-handoff, auto-retry, pings, agent-inbox          | ⚠️ `tab:turnComplete` et `metrics.counters` ; ni session id, ni transcript, ni quota provider                   |
| **Notifications**                    | focus-notify, ntfysh, push, pings                                                                    | ❌ aucune API plugin                                                                                            |
| **Palette de commandes**             | command-palette, command-center, navigator, herdr-bar, palette                                       | ⚠️ `actions.register(verb, handler)` : sans titre, et non énumérable                                            |
| **Git et revue**                     | reviewr, hunk-diff, annotate, gitview, gh-pr, pr-tracker                                             | ⚠️ `ui.git.status()` en lecture, plus le fournisseur de message de commit                                       |
| **Automatisation planifiée**         | routines, workflows, auto-pilot, PromptPilot                                                         | ❌ pas d'horloge dans le daemon                                                                                 |
| **Distribution**                     | plugin-manager, herdr-lazy, plugins-directory                                                        | ✅ `plugin install owner/repo` ; ❌ ni `search`, ni `update`, ni index                                          |

## 9.1 Le constat, qui n'est pas celui qu'on attendait

Notre API est **déjà plus riche que celle de herdr** : noyau typé, deux
moitiés, reload à chaud, `contributes`, `doctor`, kit de test, le CLI comme œil
de l'agent. Un plugin herdr est un manifeste TOML et un processus ; le nôtre a
des services injectables et un cycle de vie.

Ce qui manque n'est donc pas de l'API, ce sont **trois surfaces** — et elles
portent à elles seules la majorité des 954. Cinq des dix plugins herdr les plus
étoilés sont un programme externe dans un pane ; c'est un seul trou, et c'est le
plus gros.

## 9.2 Décisions

**D1 — Un pane peut héberger un processus, pas seulement du React.**
`LayoutLeaf` a déjà `kind: 'plugin'` ; ce qui lui manque est un pane adossé à un
PTY que le plugin possède et que la fibre ferme.

```ts
ctx.ui.panes.registerCommand({
  id: 'lazygit',
  title: 'lazygit',
  command: ['lazygit'],
  cwd: 'workspace', // ou un chemin absolu
})
ctx.ui.panes.open('lazygit', 'vertical')
```

Et le même en déclaratif dans le manifeste (`panes: [...]`), sans une ligne de
TypeScript. C'est exactement l'histoire que l'`exec-adapter` donne déjà au
daemon — « un plugin dans n'importe quel langage » — appliquée à l'interface :
un binaire Rust ou Go **à côté** d'un agent.

**D2 — Le layout devient une API, pas seulement des touches.** `ctx.ui.layout`
expose ce que le clavier fait déjà : `split`, `focusDirection`, `move`, `swap`,
`zoom`, `resize`, `close`, et `apply(tree)` pour un layout déclaratif.
`ctx.workspaces` gagne `create` / `remove` — le CLI les a déjà
(`workspace/create-core.ts`), c'est la moitié plugin qui est restée en lecture
seule.

**D3 — Un plugin peut être un service, pas seulement une commande.**

```jsonc
{ "services": [{ "id": "relay", "command": ["./bin/relay"], "restart": "on-failure" }] }
```

Supervisé par le daemon, arrêté avec la fibre, redémarré selon `restart`. Le
`commands[]` one-shot reste ce qu'il est ; un pont mobile n'est pas une
commande qui finit.

**D4 — Les événements sortent du processus.** `aimux events --follow` en
NDJSON, sur les quatorze événements déjà publiés dans
`daemon/plugin-host.ts` — la liste _est_ le vocabulaire, la décision de
l'exposer est déjà prise. C'est la porte d'entrée de toute la famille
mobile/remote/telemetry, dans n'importe quel langage, sans SDK.

**D5 — Une notification a un fournisseur.** `ctx.notifications.notify(...)`,
et surtout `provide(sink)` sur le modèle de `provideCommitMessage` : un plugin
ntfy ou Telegram **remplace** le toast natif au lieu de le doubler. Un à la
fois, le second est refusé et le sait.

**D6 — Une action a un titre.** `actions.register` prend un titre et une
description, et `ctx.commands.list()` agrège actions, `commands[]` et verbes
CLI. Sans énumération, une palette écrite par un tiers n'a rien à lister — et
c'est la famille qui revient le plus souvent après les panes.

**D7 — L'installation ne change pas ; l'index, si.** `plugin install
owner/repo` tient. Ce qui manque est le topic GitHub `aimux-plugin` comme
convention, `plugin search` / `plugin update`, une page sur le site de docs, et
un écran de gestion dans l'app.

## 9.3 Chantiers, par ordre de dépendance

**A · Le pane qui lance un programme** (≈ 2 semaines — le plus rentable).
`registerCommand` + `panes:` au manifeste + le PTY tenu par la fibre. Tests :
le pane survit à un reload de plugin, un unlink tue le processus, un programme
qui meurt laisse un pane qui le dit plutôt qu'un rectangle vide.

**B · Layout et workspaces** (≈ 2 semaines). D2. Les verbes existent déjà comme
actions clavier ; le travail est de les rendre appelables et de les tester sans
clavier, via `aimux action run`.

**C · Commandes énumérables** (≈ 3 jours, à faire avec B). D6.

**D · Services et flux d'événements** (≈ 1,5 semaine). D3 et D4.

**E · Notifications** (≈ 3 jours). D5.

**F · Session et usage de l'agent** (≈ 1 semaine).
`ctx.assistants.session(tabId)` → `{ sessionId, transcriptPath, model }`,
`usage(tabId)`, `resume(...)`. C'est ce qui manque à un tableau de bord de
tokens, à un handoff, à une reprise après rate limit.

**G · Git en écriture** (≈ 1 semaine). `diff(path, { staged })`, `stage`,
`unstage`, `discard`, `commit`.

**H · Distribution** (≈ 1 semaine). D7.

**I · Isolation.** La moitié daemon dans un `Worker` Bun — déjà noté en phase
5, et un service supervisé (D3) en réduit l'urgence sans la supprimer.

## 9.4 Ordre proposé

**A → B + C → D + E → F → G → H.** A, B et D sont le noyau de parité : après
eux, un plugin herdr typique a un équivalent aimux écrivable. Le reste est du
confort qui se rattrape plugin par plugin, quand un plugin réel le réclame.

## 9.6 Avancement (2026-09-03)

Implémenté en une passe, dans l'ordre A → B + C → D + E → F → G → H :

- **A** `ctx.ui.panes.registerCommand` + `panes[]` au manifeste ; le pane est
  un tab terminal marqué `pluginPane`, survit au reload, meurt à l'unlink,
  reste à l'écran en disant que le programme est mort. Tests dans
  `test/integration/plugin-command-panes.test.ts`.
- **B** `ctx.ui.layout` (`split`, `focus`, `swap`, `resize`, `close`, `tree`,
  `panes`) et `ctx.workspaces.create/remove` sur le noyau du CLI via un
  `WorkspaceRegistrar`. `swap-pane` est une action nouvelle. Zoom et
  `apply(tree)` laissés dehors — voir `docs/developer/plugins.md`.
- **C** `actions.register(verb, handler, meta)`, `ctx.commands.list()`,
  `aimux action list`.
- **D** `services[]` supervisés (`ServiceSupervisor`, `aimux plugin services`,
  `restart-service`) et `aimux events follow` en NDJSON.
- **E** `ctx.ui.notifications.notify/provide` ; le son natif se tait quand un
  plugin tient la fente.
- **F** `ctx.assistants.session/usage/resume`.
- **G** `ctx.ui.git.diff/stage/unstage/discard/commit`.
- **H** `aimux plugin search` (topic GitHub `aimux-plugin`) et `plugin update`.
- **I** non fait.

## 9.5 Laissé dehors, exprès

Une horloge dans le daemon pour la famille « routines » : un service de D3 avec
son propre `setInterval` fait le travail, et un cron maison est une surface
qu'on maintiendrait pour un plugin. Un protocole socket documenté hors CLI :
la navigation nvim de herdr l'exige pour la latence, on verra après B si le CLI
suffit. Et un bac à sable pour `build` — le consentement de `plugin install`
reste ce qu'il est, on ne prétend pas mieux.

# Phase 10 · Un tiroir par plugin, et des raccourcis qu'on règle

La navigation des réglages ne génère plus une section par manifeste : la
section unique `Plugins` contient un tiroir fermé par plugin. Ouvert, il garde
ensemble activation, config, raccourcis et diagnostic CLI.

Décisions livrées : D1 tiroirs hors `AppState`, D2 en-têtes `action`, D3 IDs et
descriptions additives sous API v1, D4 résolution manifeste ← registre ←
`aimux.config.ts` avec `null` pour délier, D5 capture dédiée, D6 aide fusionnée
avec le trie vivant. Les écritures UI/CLI restent dans `aimux-plugins.json` et
reconstruisent la fibre.
