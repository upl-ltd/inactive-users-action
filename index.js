// const github = require('@actions/github')
//   , core = require('@actions/core')

const fs = require('fs')
  , path = require('path')
  , core = require('@actions/core')
  , io = require('@actions/io')
  , json2csv = require('json2csv')
  , OrganizationActivity = require('./src/OrganizationUserActivity')
  , githubClient = require('./src/github/githubClient')
  , dateUtil = require('./src/dateUtil')
;
const axios = require('axios');
class OrganizationActivityWithEmail extends OrganizationActivity {
  async getUserActivityWithEmail(organization, fromDate) {
    const activities = await this.getUserActivity(organization, fromDate);

    // Fetch user email addresses using the GitHub API with read:user scope
    const usersWithEmail = await Promise.all(
      activities.map(async (activity) => {
        try{
        const userInfo = await this.octokit.rest.users.getByUsername({
          username: activity.login,
        });

        const restApiEmail = await this.fetchEmailFromRestAPI(activity.login);
          
        console.log(`User Info for ${activity.login}:`, userInfo.data);
        console.log(`Email fetched using REST API for ${activity.login}:`, restApiEmail);

        return {
          ...activity,  
          email: userInfo.data.email || restApiEmail,
        };
           } catch (error) {
        console.error(`Error fetching user info for ${activity.login}:`, error.message);
        return activity; // Keep the original data in case of an error
      }
      })
    );

    return usersWithEmail;
  }


async fetchEmailFromRestAPI(username) {
    const orgToken = process.env.ORG_TOKEN; // Use your organization token
    const apiUrl = 'https://api.github.com/graphql';

    const query = `
      {
        enterprise(slug: "upl") {
          ownerInfo {
            samlIdentityProvider {
              externalIdentities(after: null, first: 100) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
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
    `;

    try {
      const response = await axios.post(apiUrl, {
        query,
      }, {
        headers: {
          Authorization: `Bearer ${orgToken}`,
          'Content-Type': 'application/json',
        },
      });

      const email = response.data.data.enterprise.ownerInfo.samlIdentityProvider.externalIdentities.edges
        .find(edge => edge.node.user.login === username)?.node.samlIdentity.nameId;

      return email || '';
    } catch (error) {
      console.error(`Error fetching email using REST API for ${username}:`, error.message);
      return '';
    }
  }
}



async function run() {
  const since = core.getInput('since')
    , days = core.getInput('activity_days')
    , token = getRequiredInput('token')
    , outputDir = getRequiredInput('outputDir')
    , organization = getRequiredInput('organization')
    , maxRetries = getRequiredInput('octokit_max_retries')
  ;

  let fromDate;
  if (since) {
    console.log(`Since Date has been specified, using that instead of active_days`)
    fromDate = dateUtil.getFromDate(since);
  } else {
    fromDate = dateUtil.convertDaysToDate(days);
  }

  // Ensure that the output directory exists before we our limited API usage
  await io.mkdirP(outputDir)

  const octokit = githubClient.create(token, maxRetries), 
    orgActivity = new OrganizationActivityWithEmail(octokit)
  ;

  console.log(`Attempting to generate organization user activity data, this could take some time...`);
  const userActivity = await orgActivity.getUserActivityWithEmail(organization, fromDate); 
  saveIntermediateData(outputDir, userActivity.map(activity => activity.jsonPayload));

  // Convert the JavaScript objects into a JSON payload so it can be output
  console.log(`User activity data captured, generating report...`);
  const data = userActivity.map(activity => ({
    login: activity.login,
    email: activity.email, // Include email address in the report
    isActive: activity.isActive,
    commits: activity.commits,
    issues: activity.issues,
    issueComments: activity.issueComments,
    prComments: activity.prComments,
  }));
  const csv = json2csv.parse(data, {});

  const file = path.join(outputDir, 'organization_user_activity.csv');
  fs.writeFileSync(file, csv);
  console.log(`User Activity Report Generated: ${file}`);

  // Expose the output csv file
  core.setOutput('report_csv', file);
  try {
    // ... (rest of the code)
  } catch (error) {
    console.error("Error in run function:", error);
    throw error; // Rethrow the error
  }
}

async function execute() {
  try {
    await run();
  } catch (error) {
    console.log("Request failed:", error);
  }
}
execute();


function getRequiredInput(name) {
  return core.getInput(name, {required: true});
}

function saveIntermediateData(directory, data) {
  try {
    const file = path.join(directory, 'organization_user_activity.json');
    fs.writeFileSync(file, JSON.stringify(data));
    core.setOutput('report_json', file);
  } catch (err) {
    console.error(`Failed to save intermediate data: ${err}`);
  }
}
