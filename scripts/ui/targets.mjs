import { MODULE_ID, FLAGS } from "../constants.mjs";
import { holdsCurrency } from "../adapters/dnd5e.mjs";

export const NOWHERE = "__nowhere__";

const isPlayerCharacter = (a) =>
  a.type === "character" && game.users.contents.some((u) => !u.isGM && a.testUserPermission(u, "OWNER"));

const containersOf = (actor) => actor.items.filter((i) => i.type === "container" && holdsCurrency(i));
const containerName = (c) => (c.parent ? `${c.parent.name}: ${c.name}` : c.name);

/**
 * The places a user can pick as the other side of a transfer, grouped for a select.
 * Players only see names they could already see: tokens they can see on the scene,
 * player characters, and containers that are theirs or flagged public. GMs also get
 * every actor and container.
 *
 * @param {User} user
 * @param {string} excludeUuid the fixed side (never offered)
 * @param {{ nowhereLabel?: string }} [opts]  GM only: adds a "nowhere" choice
 * @returns {{label:string, items:{uuid:string,name:string}[]}[]}
 */
export function buildTargets(user, excludeUuid, { nowhereLabel = null } = {}) {
  const seen = new Set([excludeUuid]);
  const groups = [];
  const group = (label, docs, nameOf) => {
    const items = [];
    for (const d of docs) {
      if (!d || seen.has(d.uuid)) continue;
      seen.add(d.uuid);
      items.push({ uuid: d.uuid, name: nameOf(d) });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    if (items.length) groups.push({ label, items });
  };
  const actorName = (a) => a.name;

  if (user.isGM && nowhereLabel) groups.push({ label: "Nowhere", items: [{ uuid: NOWHERE, name: nowhereLabel }] });

  const usable = (a) => a && holdsCurrency(a);
  group("Targeted tokens", [...(game.user.targets ?? [])].map((t) => t.actor).filter(usable), actorName);

  const onScene = (canvas?.tokens?.placeables ?? [])
    .filter((t) => user.isGM || (!t.document?.hidden && t.visible))
    .map((t) => t.actor)
    .filter(usable);
  group("Tokens on this scene", onScene, actorName);

  group("Player characters", game.actors.filter((a) => isPlayerCharacter(a)), actorName);

  const owned = game.actors.filter((a) => a.testUserPermission(user, "OWNER"));
  group("Your containers", owned.flatMap(containersOf), containerName);

  const publicContainers = [
    ...game.actors.flatMap(containersOf),
    ...game.items.filter((i) => i.type === "container" && holdsCurrency(i)),
  ].filter((c) => c.getFlag(MODULE_ID, FLAGS.publicRecipient) === true);
  group("Public containers", publicContainers, containerName);

  if (user.isGM) {
    group("All actors", game.actors.filter(usable), actorName);
    group("All containers", game.actors.flatMap(containersOf), containerName);
  }
  return groups;
}
