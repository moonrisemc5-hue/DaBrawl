export function selectWinnerByHealth(players) {
  const scores = new Map();
  for (const player of players ?? []) {
    if (!player || player.alive === false || !Number.isInteger(player.team) || !Number.isFinite(player.hp)) continue;
    scores.set(player.team, (scores.get(player.team) ?? 0) + Math.max(0, player.hp));
  }
  if (scores.size === 0) return null;
  let winningTeam = null;
  let highestScore = -Infinity;
  let tied = false;
  for (const [team, score] of scores) {
    if (score > highestScore) {
      highestScore = score;
      winningTeam = team;
      tied = false;
    } else if (score === highestScore) {
      tied = true;
    }
  }
  return tied ? null : winningTeam;
}
