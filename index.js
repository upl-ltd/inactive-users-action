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
          
        console.log(`User Info for ${activity.login}:`, userInfo.data);

        return {
          ...activity,  
          email: userInfo.data.email,
        };
           } catch (error) {
        console.error(`Error fetching user info for ${activity.login}:`, error.message);
        return activity; // Keep the original data in case of an error
      }
      })
    );

    return usersWithEmail;
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

function saveIntermediateData(directory, data) {
  try {
    const file = path.join(directory, 'organization_user_activity.json');
    fs.writeFileSync(file, JSON.stringify(data));
    core.setOutput('report_json', file);
  } catch (err) {
    console.error(`Failed to save intermediate data: ${err}`);
  }
}
