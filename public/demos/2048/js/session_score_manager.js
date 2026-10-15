// GameForge adaptation: keep only an explicitly session-scoped best score.
// This sandbox does not persist the board or scores across reloads.
function SessionScoreManager() {
  this.bestScore = 0;
}

SessionScoreManager.prototype.getBestScore = function () {
  return this.bestScore;
};

SessionScoreManager.prototype.setBestScore = function (score) {
  this.bestScore = Math.max(this.bestScore, Number(score) || 0);
};

SessionScoreManager.prototype.getGameState = function () {
  return null;
};

SessionScoreManager.prototype.setGameState = function () {};
SessionScoreManager.prototype.clearGameState = function () {};
