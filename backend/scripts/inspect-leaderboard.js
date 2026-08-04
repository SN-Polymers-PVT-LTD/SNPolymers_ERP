const { getJeLeaderboard } = require('../src/controllers/analytics.controller');

async function main() {
  const req = {
    query: {
      timeframe: 'weekly',
      zone: '918276071523' // Shreyan Ghosh
    }
  };

  let responseData = null;
  const res = {
    status: (code) => ({
      json: (data) => {
        responseData = data;
        return res;
      }
    })
  };

  await getJeLeaderboard(req, res);
  console.log('\n--- Leaderboard Response ---');
  console.log(JSON.stringify(responseData, null, 2));
}

main().catch(console.error);
