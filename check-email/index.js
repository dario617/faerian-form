const functions = require("@google-cloud/functions-framework");
const Knex = require("knex");
const validator = require("validator");

// createUnixSocketPool initializes a Unix socket connection pool for
// a Cloud SQL instance of Postgres.
const createUnixSocketPool = async (config) => {
  // Note: Saving credentials in environment variables is convenient, but not
  // secure - consider a more secure solution such as
  // Cloud Secret Manager (https://cloud.google.com/secret-manager) to help
  // keep secrets safe.
  console.log("Creating connection pool");

  return Knex({
    client: "pg",
    connection: {
      user: process.env.PGUSER, // e.g. 'my-user'
      password: process.env.PGPASSWORD, // e.g. 'my-user-password'
      database: process.env.PGDATABASE, // e.g. 'my-database'
      host: process.env.INSTANCE_UNIX_SOCKET, // e.g. '/cloudsql/project:region:instance'
    },
    // ... Specify additional properties here.
    ...config,
  });
};

async function checkEmailExistsOnDB(email, client) {
  try {
    const result = await client
      .select("email")
      .from("nftform")
      .where("email", email);
    console.log("check email exists result", result);
    return result;
  } catch (e) {
    console.error(e, e.stack);
    return null;
  }
}

function validateFieldsFromRequest(parsedBody) {
  console.log("Parsed", { body: parsedBody, email: parsedBody.email });
  try {
    validator.isEmail(parsedBody.email);
  } catch (e) {
    return null;
  }

  return {
    email: validator.normalizeEmail(validator.escape(parsedBody.email), {
      gmail_remove_dots: false,
      gmail_convert_googlemaildotcom: false,
    }),
  };
}

functions.http("handler", async (req, res) => {
  // CORS |
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    // stop preflight requests here
    res.status(204).send("");
    return;
  }
  try {
    if (req.method !== "POST") {
      res.status(400).json({ error: "only POST allowed" });
      return;
    }

    const knexClient = await createUnixSocketPool();

    console.log("Request body", req.body);

    const parsedBody = JSON.parse(req.body);

    const validatedFields = validateFieldsFromRequest(parsedBody);

    if (!validatedFields) {
      console.log("Fields are wrong", { validatedFields, body: parsedBody });
      res.status(400).json({ error: "wrong fields" });
      return;
    }

    const emailExists = await checkEmailExistsOnDB(
      validatedFields.email,
      knexClient
    );

    if (emailExists && emailExists.length === 1) {
      console.log("Email exists");
      res.status(200).json({ success: "it does" });
      return;
    } else {
      console.log("No email :(");
      res.status(404).json({ error: "email not found" });
    }
  } catch (e) {
    console.error(e, e.stack);
    res.status(500).json({ error: "oups" });
  }
});
