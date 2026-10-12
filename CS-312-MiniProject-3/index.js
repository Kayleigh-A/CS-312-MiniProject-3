import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv"
import bcrypt from "bcrypt";
import session from "express-session"

const app = express();
const port = 3000;
const saltRounds = 12;
env.config();

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.locals.user = req.session.userId || null;
    next();
});

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "BlogDB",
    password: process.env.DB_PASSWORD,
    port: 5433,
});

db.connect();


const result = await db.query("SELECT * FROM blogs");
console.log(result.rows);

app.get("/", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT * FROM blogs ORDER BY date_created DESC"        // Displays blogs in descending order
        );

        const posts = result.rows;

        res.render("index.ejs", { posts: posts });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating blog post.");
    }
    
    console.log("Logged-in user:", req.session.userId);         // Tells me who is logged in
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs");
});

app.get("/signin", (req, res) => {
    res.render("signin.ejs");
})

app.post("/signup", async (req, res) => {
    const { user_id, name, password } = req.body;

    try {
        const checkUser_id = await db.query("SELECT * FROM users WHERE user_id = $1", 
        [  user_id,
        ]);

        if (checkUser_id.rows.length > 0) {
            return res.status(409).render("signup.ejs", {
                error: "Username already taken!"
            });
        } 
        const hash = await bcrypt.hash(password, saltRounds);
        await db.query("INSERT INTO users (user_id, user_password, user_name) VALUES ($1, $2, $3)", 
            [user_id, hash, name] 
        );
        res.redirect("/signin");   
    } catch (err) {
        console.log(err);

        if (err.code === "23505") {     // 23505 is a unique violation in Postgres
            return res.status(409).render("signup.ejs", {
                error: "Username already taken!"
            });
        } 

        res.status(500).send("Something went wrong.");
    }
});


app.post("/signin", async (req, res) => {
    const { user_id, password } = req.body;

    try {
        const result = await db.query(
            "SELECT * FROM users WHERE user_id = $1", [user_id]
        );

        if(result.rows.length === 0) {
            return res.status(401).render("signin.ejs", {
                error: "Incorrect username or password! Try Again."
            });
        }

        const user = result.rows[0];

        const isMatch = await bcrypt.compare(
            password, user.user_password
        );

        if(!isMatch) {
            return res.status(401).render("signin.ejs", {
                error: "Incorrect username or password! Try Again."
            });
        }

        req.session.regenerate((err) => {           // creates a fresh session after authentication
            if (err) {
                console.error(err);
                return res.status(500).send("Login Failed.");
            }

            req.session.userId = user.user_id;      // saving the user_id in the session!

            req.session.save((err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send("Login Failed.");
                }

                res.redirect("/");                  // FINALLY being able to access the homepage after successful log in
            });
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Something went wrong!");
    }
});

app.post("/logout", (req, res) => {
    req.session.destroy((err) => {          // Deletes the session
        if (err) {
            console.error(err);
            return res.status(500).send("Logout Failed.");
        }

        res.clearCookie("cookie.sid");      // clears the session cookie
        res.redirect("/signin");            
    })
})

// Grabbing post information from user 
app.post("/posts", async (req, res) =>{


    const { title, postContent } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.redirect("/signin");
    }

    try{
        const userResult = await db.query(
            "SELECT user_name FROM users WHERE user_id = $1",
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).send("User not found!");
        }

        const creatorName = userResult.rows[0].user_name;

        await db.query(
            "INSERT INTO blogs (creator_name, creator_user_id, title, body, date_created) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)",
            [creatorName, userId, title, postContent]
        );

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating blog post.")
    }
});

// Find your original post to edit
app.get("/posts/:id/edit", async (req, res) => {     

    try {
        const result = await db.query(
            "SELECT * FROM blogs WHERE blog_id = $1 AND creator_user_id = $2", 
            [req.params.id, req.session.userId]
        );

        if (result.rows.length === 0) {
            return res.status(400).send("Post not found!");
        }

        const post = result.rows[0];

        res.render("edit.ejs", { post });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error retrieving post.");
    }

});

// Submit edited changes to post and return to homepage
app.post("/posts/:id/edit", async (req, res) => {

    const { title, postContent } = req.body;

    try {
        const result = await db.query(
            "UPDATE blogs SET title = $1, body = $2 WHERE blog_id = $3 AND creator_user_id = $4 RETURNING blog_id", // Used RETURNING to make sure a row was changed
            [title, postContent, req.params.id, req.session.userId]
        );

        if (result.rowCount === 0){
            return res.status(404).send("Post not found!");
        }

        res.redirect("/");
    } catch (err){
        console.error(err);
        res.status(500).send("Error updating post!")
    }
});

// Delete post
app.post("/posts/:id/delete", async (req, res) =>{

    try {
        const result = await db.query(
            "DELETE FROM blogs WHERE blog_id = $1 AND creator_user_id = $2 RETURNING blog_id",
            [req.params.id, req.session.userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).send("Post not found!");
        }

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting post.");
    }


});



app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
