const functions = require("@google-cloud/functions-framework");
const otpGenerator = require("otp-generator");
const Knex = require("knex");
const validator = require("validator");
const axios = require("axios");
const uuid = require("uuid");

const config = {
  BASE_URL: "https://api.brevo.com/v3/smtp/email",
};

const myAxiosInstance = axios.create({
  baseURL: config.BASE_URL,
  timeout: 30000,
});

myAxiosInstance.interceptors.request.use((config) => {
  const customUuid = uuid.v4();
  config.reqId = customUuid;
  const message = {
    reqId: customUuid,
    time: Date.now(),
    config: config,
  };

  console.info(message);
  return config;
});

myAxiosInstance.interceptors.response.use(
  (response) => {
    const customUuid =
      response.config && response.config.reqId ? response.config.reqId : "";
    const message = {
      reqId: customUuid,
      time: Date.now(),
      status: response.status,
      data: response.data,
      headers: response.headers,
      logMessage: "RESPONSE RECEIVED",
    };
    console.info(message);
    return response;
  },
  (error) => {
    const customUuid =
      error.response && error.response.config && error.response.config.reqId
        ? error.response.config.reqId
        : "";

    const errorResponse = error.response
      ? error.response
      : {
          status: null,
          data: null,
          headers: null,
        };
    const message = {
      reqId: customUuid,
      time: Date.now(),
      status: errorResponse.status,
      data: errorResponse.data,
      headers: errorResponse.headers,
      logMessage: error.message || "ERROR",
    };
    console.error(message);
    return Promise.reject(error);
  }
);

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
      .select("email", "accesscode")
      .from("nftform")
      .where("email", email);
    console.log("check email exists result", result);
    return result;
  } catch (e) {
    console.error(e, e.stack);
    return null;
  }
}

async function saveForm(validatedFields, client) {
  try {
    const otp = otpGenerator.generate(10, {
      upperCaseAlphabets: true,
      specialChars: false,
      lowerCaseAlphabet: false,
    });

    const result = await client
      .insert({ ...validatedFields, accesscode: otp, premium: false })
      .into("nftform");
    console.log("insert form to db", result);
    return otp;
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
    name: validator.escape(parsedBody.name),
    prompt: validator.escape(parsedBody.prompt),
    twitter: validator.escape(parsedBody.twitter),
  };
}

async function sendEmailWithCode(variables) {
  if (!process.env.BREVO_API_KEY) {
    console.error("Failed to send email because api key is not defined");
  }

  await myAxiosInstance
    .post(
      "https://api.brevo.com/v3/smtp/email",
      {
        to: [
          {
            email: variables.email,
            name: variables.name,
          },
        ],
        templateId: process.env.BREVO_TEMPLATE_ID ?? 63,
        params: {
          ORDERCODE: variables.otp,
          CONTENT: variables.prompt,
        },
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          accept: "application/json",
          "content-type": "application/json",
        },
      }
    )
    .then(function (response) {
      //console.log("response", response);
    })
    .catch(function (error) {
      //console.log("failed to send email", error);
    });
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

    const parsedBody = JSON.parse(req.body);

    const validatedFields = validateFieldsFromRequest(parsedBody);

    if (!validatedFields) {
      console.log("Fields are wrong", { validatedFields, body: parsedBody });
    }

    const emailExists = await checkEmailExistsOnDB(
      validatedFields.email,
      knexClient
    );

    if (emailExists && emailExists.length !== 0) {
      console.log("Email exists, exiting");
      res.status(400).json({ error: "email exists" });
      return;
    }

    const insertionResult = await saveForm(validatedFields, knexClient);

    await sendEmailWithCode({ ...validatedFields, otp: insertionResult });

    console.log("All ok :)");
    res.status(200).json({ accessCode: insertionResult });
  } catch (e) {
    console.error(e, e.stack);
    res.status(500).json({ error: "oups" });
  }
});
