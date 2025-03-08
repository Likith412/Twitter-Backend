const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initialiseDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`); //check google
    process.exit(1);
  }
};

initialiseDBAndServer();

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// API 1
app.post("/register/", async (request, response) => {
  const userDetails = request.body;
  const { username, password, name, gender } = userDetails;

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
        INSERT INTO
        user (name, username, password, gender)
        VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}');
    `;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

// API 2
app.post("/login/", async (request, response) => {
  const userLoginDetials = request.body;
  const { username, password } = userLoginDetials;

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);
  const getLatestTweetsQuery = `
    SELECT 
    user.username as username,
    tweet.tweet as tweet,
    tweet.date_time as dateTime
    FROM (follower INNER JOIN tweet 
    ON follower.following_user_id = tweet.user_id) as T
    INNER JOIN user ON T.user_id = user.user_id
    WHERE follower.follower_user_id = ${user_id}
    ORDER BY tweet.date_time DESC
    LIMIT 4
    ;
  `;
  const tweetsArray = await db.all(getLatestTweetsQuery);
  response.send(tweetsArray);
});

// API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);
  const getFollowingListQuery = `
    SELECT user.name as name
    FROM user 
    INNER JOIN follower
    ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${user_id};
  `;
  const followingList = await db.all(getFollowingListQuery);
  response.send(followingList);
});

// API 5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);
  const getFollowersListQuery = `
    SELECT user.name as name
    FROM user 
    INNER JOIN follower
    ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${user_id};
  `;
  const followersList = await db.all(getFollowersListQuery);
  response.send(followersList);
});

// API 6
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);

  const getTweetQuery = `
    SELECT * FROM tweet
    WHERE tweet_id = ${tweetId};
  `;
  const tweet = await db.get(getTweetQuery);

  const getUserFollowingQuery = `
    SELECT * FROM follower
    WHERE follower_user_id = ${user_id};
`;
  const userFollowing = await db.all(getUserFollowingQuery);
  if (userFollowing.some((item) => item.following_user_id === tweet.user_id)) {
    const getTweetDetailsQuery = `
      SELECT 
      tweet.tweet as tweet,
      count(distinct like.like_id) as likes,
      count(distinct reply.reply_id) as replies,
      tweet.date_time as dateTime
      FROM tweet 
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      GROUP BY tweet.tweet_id;
    `;

    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const loginUsername = request.username;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
    const { user_id } = await db.get(selectUserQuery);

    const getTweetQuery = `
    SELECT * from tweet 
    where tweet_id = ${tweetId};
  `;
    const tweet = await db.get(getTweetQuery);

    const getUserFollowingQuery = `
    SELECT *
    FROM follower
    WHERE follower_user_id = ${user_id};
  `;
    const userFollowing = await db.all(getUserFollowingQuery);
    if (
      userFollowing.some((item) => item.following_user_id === tweet.user_id)
    ) {
      const selectQuery = `
        select 
          user.username
        from user
        inner join like on like.user_id = user.user_id
        where like.tweet_id = ${tweetId};
      `;
      const likedUsers = await db.all(selectQuery);
      const likes = likedUsers.map((user) => user.username);
      response.send({ likes });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const loginUsername = request.username;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
    const { user_id } = await db.get(selectUserQuery);

    const getTweetQuery = `
    SELECT * from tweet 
    where tweet_id = ${tweetId};
  `;
    const tweet = await db.get(getTweetQuery);

    const getUserFollowingQuery = `
    SELECT *
    FROM follower
    WHERE follower_user_id = ${user_id};
  `;
    const userFollowing = await db.all(getUserFollowingQuery);
    if (
      userFollowing.some((item) => item.following_user_id === tweet.user_id)
    ) {
      const selectQuery = `
        select 
          user.name,
          reply.reply
        from user
        inner join reply on user.user_id = reply.user_id
        where reply.tweet_id = ${tweetId};
      `;
      const replies = await db.all(selectQuery);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);
  const getTweetsQuery = `
    SELECT tweet.tweet as tweet,
    count(distinct like.like_id) as likes,
    count(distinct reply.reply_id) as replies,
    tweet.date_time as dateTime
    FROM tweet 
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${user_id}
    GROUP BY tweet.tweet_id;
  `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);

  const { tweet } = request.body;
  const now = new Date().toISOString().replace("T", " ").split(".")[0];

  const createTweet = `
    insert into tweet(tweet, user_id, date_time)
    values ('${tweet}', ${user_id}, '${now}');
  `;
  await db.run(createTweet);
  response.send("Created a Tweet");
});

// API 11
app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const loginUsername = request.username;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${loginUsername}';`;
  const { user_id } = await db.get(selectUserQuery);

  const selectQuery = `
    SELECT *
    FROM tweet 
    INNER JOIN user on user.user_id = tweet.user_id
    WHERE tweet.tweet_id = ${tweetId}
    and user.user_id = ${user_id};
    `;
  const tweet = await db.get(selectQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
