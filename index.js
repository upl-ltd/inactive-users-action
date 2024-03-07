const axios = require('axios');
const fs = require('fs');
const path = require('path');
const core = require('@actions/core');
const io = require('@actions/io');
const json2csv = require('json2csv');
const OrganizationActivity = require('./src/OrganizationUserActivity');
const githubClient = require('./src/github/githubClient');
const dateUtil = require('./src/dateUtil');

async function getSSOEmails(token) {
  const response = await axios({
    url: 'https://api.github.com/graphql',
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      query: `
        {
          enterprise(slug: "upl") {
            ownerInfo {
              samlIdentityProvider {
                externalIdentities(after: null, first: 100) {
                  edges {
                    node {
                      samlIdentity {
                        nameId
                      }
                      user {
                        login
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
    },
  });

  return response.data.data.enterprise.ownerInfo.samlIdentityProvider.externalIdentities.edges.map(edge => {
    return {
      ssoEmail: edge.node.samlIdentity.nameId,
      username: edge.node.user.login,
    };
  });
}

async function run() {
  const since = core.getInput('since');
  const days = core.getInput('activity_days');
  const token = getRequiredInput('token');
  const outputDir = getRequiredInput('outputDir');
  const organization = getRequiredInput('organization');
  const maxRetries = getRequiredInput('octokit_max_retries');

  let fromDate;
  if (since) {
    console.log(`Since Date has been specified, using that instead of active_days`);
    fromDate = dateUtil.getFromDate(since);
  } else {
    fromDate = dateUtil.convertDaysToDate(days);
  }

  await io.mkdirP(outputDir);

  const octokit = githubClient.create(token, maxRetries);
  const orgActivity = new OrganizationActivity(octokit);

  console.log(`Attempting to generate organization user activity data, this could take some time...`);
  const userActivity = await orgActivity.getUserActivity(organization, fromDate);

  console.log(`User activity data captured, fetching SSO emails...`);
  const ssoEmails = await getSSOEmails(token);

  const data = userActivity.map(activity => {
    const ssoEmail = ssoEmails.find(email => email.username === activity.jsonPayload.username);
    return {
      ...activity.jsonPayload,
      ssoEmail: ssoEmail ? ssoEmail.ssoEmail : 'N/A',
    };
  });

  console.log(`Data captured, generating report...`);
  const csv = json2csv.parse(data, {});

  const file = path.join(outputDir, 'organization_user_activity.csv');
  fs.writeFileSync(file, csv);
  console.log(`User Activity Report Generated: ${file}`);

  core.setOutput('report_csv', file);
}

async function execute() {
  try {
    await run();
  } catch (err) {
    core.setFailed(err.message);
  }
}

execute();

function getRequiredInput(name) {
  return core.getInput(name, {required: true});
}
