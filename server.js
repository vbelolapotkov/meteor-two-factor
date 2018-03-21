/* globals twoFactor */

twoFactor.options = {};

const generateCode = () => {
  return Array(...Array(6))
    .map(() => {
      return Math.floor(Math.random() * 10);
    })
    .join('');
};

const NonEmptyString = Match.Where(x => {
  check(x, String);
  return x.length > 0;
});

const userQueryValidator = Match.Where(user => {
  check(user, {
    id: Match.Optional(NonEmptyString),
    username: Match.Optional(NonEmptyString),
    email: Match.Optional(NonEmptyString),
  });
  if (Object.keys(user).length !== 1) {
    throw new Match.Error('User property must have exactly one field');
  }
  return true;
});

const passwordValidator = { digest: String, algorithm: String };

const invalidLogin = () => {
  return new Meteor.Error(403, 'Invalid login credentials');
};

const getFieldName = () => {
  return twoFactor.options.fieldName || 'twoFactorCode';
};

const verifyUser = ({userQuery, password}) => {
  const user = Accounts._findUserByQuery(userQuery);
  if (!user) {
    throw invalidLogin();
  }

  const checkPassword = Accounts._checkPassword(user, password);
  if (checkPassword.error) {
    throw invalidLogin();
  }

  return user;
};

Meteor.methods({
  'twoFactor.getAuthenticationCode'(userQuery, password) {
    check(userQuery, userQueryValidator);
    check(password, passwordValidator);

    const user = verifyUser({userQuery, password});

    const code =
      typeof twoFactor.generateCode === 'function'
        ? twoFactor.generateCode()
        : generateCode();

    if (typeof twoFactor.sendCode === 'function') {
      twoFactor.sendCode(user, code);
    }

    const fieldName = getFieldName();

    Meteor.users.update(user._id, {
      $set: {
        [fieldName]: code,
      },
    });
  },
  'twoFactor.resendAuthenticationCode'(userQuery, password) {
    check(userQuery, userQueryValidator);
    check(password, passwordValidator);

    const user = verifyUser({userQuery, password});

    const fieldName = getFieldName();
    const code = user[fieldName];

    if (typeof twoFactor.sendCode === 'function') {
      twoFactor.sendCode(user, code);
    }
  },
  'twoFactor.verifyCodeAndLogin'(options) {
    check(options, {
      user: userQueryValidator,
      password: passwordValidator,
      code: String,
    });

    const fieldName = getFieldName();

    const user = verifyUser({
      userQuery: options.user,
      password: options.password
    });

    if (options.code !== user[fieldName]) {
      throw new Meteor.Error(403, 'Invalid code');
    }

    Meteor.users.update(user._id, {
      $unset: {
        [fieldName]: '',
      },
    });

    return Accounts._attemptLogin(this, 'login', '', {
      type: '2FALogin',
      userId: user._id,
    });
  },
  'twoFactor.abort'(userQuery, password) {
    check(userQuery, userQueryValidator);
    check(password, passwordValidator);

    const user = verifyUser({userQuery, password})
    const fieldName = getFieldName();

    Meteor.users.update(user._id, {
      $unset: {
        [fieldName]: '',
      },
    });
  },
});

Accounts.validateLoginAttempt(options => {
  const customValidator = () => {
    if (typeof twoFactor.validateLoginAttempt === 'function') {
      return twoFactor.validateLoginAttempt(options);
    }
    return false;
  };

  const allowedMethods = ['createUser', 'resetPassword', 'verifyEmail'];

  if (
    customValidator() ||
    options.type === 'resume' ||
    allowedMethods.indexOf(options.methodName) !== -1
  ) {
    return true;
  }

  if (options.type === '2FALogin' && options.methodName === 'login') {
    return options.allowed;
  }

  return false;
});
