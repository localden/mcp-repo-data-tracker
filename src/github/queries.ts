/**
 * GraphQL queries for GitHub API
 */

export const FETCH_ISSUES_QUERY = `
  query FetchIssues($owner: String!, $repo: String!, $after: String, $states: [IssueState!]) {
    repository(owner: $owner, name: $repo) {
      issues(first: 50, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          number
          title
          state
          createdAt
          updatedAt
          closedAt
          author { login }
          labels(first: 20) { nodes { name } }
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt
              author { login }
            }
            totalCount
          }
          timelineItems(first: 50, itemTypes: [REOPENED_EVENT, CLOSED_EVENT]) {
            nodes {
              ... on ReopenedEvent { createdAt }
              ... on ClosedEvent { createdAt }
            }
          }
        }
      }
    }
  }
`;

export const FETCH_ISSUE_COMMENTS_QUERY = `
  query FetchIssueComments($issueId: ID!, $after: String) {
    node(id: $issueId) {
      ... on Issue {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            createdAt
            author { login }
          }
        }
      }
    }
  }
`;

export const FETCH_PRS_QUERY = `
  query FetchPRs($owner: String!, $repo: String!, $after: String, $states: [PullRequestState!]) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 50, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          number
          title
          state
          isDraft
          createdAt
          updatedAt
          mergedAt
          closedAt
          author { login }
          additions
          deletions
          changedFiles
          labels(first: 20) { nodes { name } }
          reviews(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt
              state
              author { login }
            }
            totalCount
          }
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt
              author { login }
            }
            totalCount
          }
          timelineItems(first: 20, itemTypes: [REOPENED_EVENT]) {
            nodes {
              ... on ReopenedEvent { createdAt }
            }
          }
        }
      }
    }
  }
`;

export const FETCH_COMMITS_QUERY = `
  query FetchCommits($owner: String!, $repo: String!, $since: GitTimestamp!, $after: String) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 100, since: $since, after: $after) {
              pageInfo { hasNextPage endCursor }
              totalCount
              nodes {
                committedDate
                author {
                  user { login }
                }
              }
            }
          }
        }
      }
    }
  }
`;
