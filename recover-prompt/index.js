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

async function recoverDataFromDB(email, accesscode, client) {
  try {
    const result = await client
      .select("email", "accesscode", "prompt")
      .from("nftform")
      .where({ email: email, accesscode: accesscode });
    console.log("check exists", result);
    return result;
  } catch (e) {
    console.error(e, e.stack);
    return null;
  }
}

function validateFieldsFromRequest(parsedBody) {
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
    code: validator.escape(parsedBody.accesscode),
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
    const knexClient = await createUnixSocketPool();

    console.log("body and params", { body: req.body, params: req.query });

    let parsedBody = {};
    if (req.method === "POST") {
      parsedBody = JSON.parse(req.body);
    } else if (req.method === "GET") {
      parsedBody = req.query;
    }

    const validatedFields = validateFieldsFromRequest(parsedBody);

    if (!validatedFields) {
      console.log("Fields are wrong", { validatedFields, body: parsedBody });
    }

    const recovered = await recoverDataFromDB(
      validatedFields.email,
      validatedFields.code,
      knexClient
    );

    if (!recovered || recovered?.length === 0) {
      console.log("No email exists, exiting");
      res.status(400).json({ error: "No email exists" });
      return;
    }

    const data = recovered[0];

    console.log("All ok :)");
    res.status(200).json({ prompt: data.promt });
  } catch (e) {
    console.error(e, e.stack);
    res.status(500).json({ error: "oups" });
  }
});
