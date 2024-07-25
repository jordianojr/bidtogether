import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.get("/", (req, res) => {
  res.render("home.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/initiate", (req, res) => {
  res.render("initiate.ejs");
});

app.get("/signed-up", async (req, res) => {
  const email = req.user.email;
  try {
      const result = await db.query("SELECT current_year, study_semester, module_code, section_code FROM sections WHERE email = $1", [email]);
      if (result.rows.length === 0) {
        // return []; // Returning an empty array or null depending on your application's logic
        res.render("signedup.ejs", {
          user: email,
          sections: []
        });
      } else {
        res.render("signedup.ejs", {
          user: email,
          sections: result.rows
        });  
      }
  } catch (err) {
    console.error('Error in /board route:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get("/board", async (req, res) => {
  const email = req.user.email;
  try {
    const modResult = await db.query("SELECT module_code FROM modules WHERE email = $1", [email]);
    const mods = modResult.rows;
    const displayPromises = mods.map(async (mod) => {
      const m = mod.module_code;
      const result = await db.query("SELECT current_year, study_semester, module_code, section_code, COUNT(*) as studentNo FROM sections WHERE module_code = $1 GROUP BY current_year, module_code, study_semester, section_code", [m]);
      if (result.rows.length === 0) {
        return []; // Returning an empty array or null depending on your application's logic
      }
      const sectionPromises = result.rows.map(async (res) => {
        return {
          module: res.module_code,
          year: res.current_year,
          semester: res.study_semester,
          section: res.section_code,
          studentNo: res.studentno
        };
      });
      const sections = await Promise.all(sectionPromises);
      return sections;
    });
    const display = await Promise.all(displayPromises);
    console.log(display);
    res.render("board.ejs", {
      user: email,
      modules: mods,
      sections: display
    });
  } catch (err) {
    console.error('Error in /board route:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get("/indicate", (req, res) => {
  res.render("indicate.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.get("/main", async (req, res) => {
  console.log(req.user);
  if (req.isAuthenticated()) {
    const email = req.user.email;
    try {
      const result = await db.query("SELECT * FROM details WHERE email = $1", [
        email,
      ]);
      if (result.rows.length > 0) {
        res.render("main.ejs", { 
          user: email,
          course: result.rows[0].course,
          studyYear: result.rows[0].study_year,
          name: result.rows[0].name,
          phone: result.rows[0].phone_number,
         });
      } else {
        res.render("info.ejs", { user: email });
      }
    } catch (err) {
      console.log(err);
    }
  } else {
    res.redirect("/login");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", {
    successRedirect: "/main",
    failureRedirect: "/login",
  })
);

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/main",
    failureRedirect: "/login",
  })
);

app.post("/info", async (req, res) => {
  const email = req.user.email;
  const course = req.body.course;
  const studyYear = req.body.studyYear;
  const name = req.body.name;
  const phone = req.body.phone;

  try {
    const result = await db.query("INSERT INTO details (email, course, study_year, name, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *", 
    [email, course, studyYear, name, phone]);
    res.redirect("/main");
  } catch (err) {
    console.log(err);
  }
}
);

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      req.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/main");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/submit-modules", async (req, res) => {
  const currentDate = new Date();

  const email = req.user.email;
  const courseResult = await db.query("SELECT course FROM details WHERE email = $1", [email]);
  const course = courseResult.rows[0].course; // Assuming the query returns one course
  const currentYear = currentDate.getFullYear();
  const studyYear = req.body.year;
  const studySemester = req.body.semester;
  const modules = req.body.modules;

  modules.forEach(async (module) => {
    try {
      const result = await db.query("INSERT INTO modules (email, course, current_year, study_year, study_semester, module_code) VALUES ($1, $2, $3, $4, $5, $6);", 
      [email, course, currentYear, studyYear, studySemester, module]);
    } catch (err) {
      console.log(err);
    }  
  });
  res.redirect("/main");
}
);

app.post("/start-group", async (req, res) => {
  const currentDate = new Date();
  const email = req.user.email;
  const nameResult = await db.query("SELECT name FROM details WHERE email = $1", [email]);
  const name = nameResult.rows[0].name;
  const currentYear = currentDate.getFullYear();
  const studySemester = req.body.semester;
  const module = req.body.module;
  const section = req.body.section;
    try {
      const result = await db.query("INSERT INTO sections (email, current_year, study_semester, name, module_code, section_code) VALUES ($1, $2, $3, $4, $5, $6);", 
      [email, currentYear, studySemester, name, module, section]);
    } catch (err) {
      console.log(err);
    }
    res.redirect("/board");  
  });

  app.post("/join-group", async (req, res) => {
    console.log("THIS IS THE BODY");  
    console.log(req.body);
    console.log("THIS IS THE BODY"); 
    const info = req.body.join.split(" "); 
    console.log(info);
    const email = req.user.email;
    const nameResult = await db.query("SELECT name FROM details WHERE email = $1", [email]);
    const name = nameResult.rows[0].name;
    const currentYear = info[2];
    const studySemester = info[3];
    const module = info[0];
    const section = info[1];
      try {
        const result = await db.query("INSERT INTO sections (email, current_year, study_semester, name, module_code, section_code) VALUES ($1, $2, $3, $4, $5, $6);", 
        [email, currentYear, studySemester, name, module, section]);
      } catch (err) {
        console.log(err);
      }
      res.redirect("/board");  
    });
  
  
passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2)",
            [profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
