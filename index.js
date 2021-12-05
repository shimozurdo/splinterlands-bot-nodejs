const Splinterlands = require("./splinterlands");

async function run() {
  const configSplinterlands = {
    battle_api_url: "https://battle.splinterlands.com",
    api_url: "https://steemmonsters.com",
    ws_url: "wss://ws.steemmonsters.io",
    tx_broadcast_url: "https://broadcast.splinterlands.io",
  };

  const splinterlands = new Splinterlands(configSplinterlands);
  await splinterlands.init();

  const player = {
    name: "shimozurdo",
    postingKey: "*************************************",
  };

  console.log(`@${player.name} login`);

  await splinterlands.player_login(player.name, player.postingKey);
  await splinterlands.wait_for_player_login(player.name);

  let match = await splinterlands.find_match("Ranked", player.name);

  console.log(`@${player.name} submitted find match transaction...`);
  match = await splinterlands.wait_for_match(match);

  console.log(`@${player.name} found match against @${match.opponent_player}!`);

  // ----  Choose cards (EXAMPLE) ----- //

  const team = [
    "starter-224-4mobA", //summoner
    "starter-50-dQydr", //monster 1
    "starter-51-wu89v", //monster 2
  ];

  // -----  Choose cards  ----- //

  const sendBattlePm = new Promise((resolve, reject) => {
    setTimeout(() => {
      console.log(`@${player.name} preparing team...`);
      splinterlands
        .submit_team(match, team[0], team.slice(1), player.name)
        .then((res) => {
          console.log(`@${player.name} submitted team...`);
          resolve(res);
        })
        .catch((err) => {
          reject(err);
        });
    }, 5000);
  });

  sendBattlePm
    .then(() => {
      return splinterlands.wait_for_result(match);
    })
    .then((id) => {
      return splinterlands.api("/battle/result", { id });
    })
    .then((res) => {
      splinterlands.resume_match(player.name);

      console.log(
        `Winner @${res.winner}!, looser @${
          res.winner == player.name ? match.opponent_player : player.name
        }`
      );

      console.log(`End battle`);
    })
    .catch((err) => {
      splinterlands.resume_match(player.name);

      throw err;
    });

  return { message: `${player.name} ended up the battle.` };
}

run();
